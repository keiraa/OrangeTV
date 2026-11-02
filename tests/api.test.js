const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createApp } = require('../server/server');

async function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'orangetv-api-'));
  const media = path.join(root, 'media');
  const dataDir = path.join(root, 'data');
  fs.mkdirSync(media);
  fs.writeFileSync(path.join(media, 'Movie (2020).mp4'), '0123456789');
  fs.writeFileSync(path.join(media, 'Show S01E01.mp4'), 'episode');
  const app = createApp({ dataDir, mediaPaths: [media] });
  const server = app.listen(0, '127.0.0.1');
  await new Promise((resolve, reject) => {
    server.once('listening', resolve);
    server.once('error', reject);
  });
  const url = `http://127.0.0.1:${server.address().port}`;
  t.after(async () => {
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
    fs.rmSync(root, { recursive: true, force: true });
  });
  const library = await (await fetch(`${url}/api/library`)).json();
  const json = (route, body, method = 'POST') =>
    fetch(url + route, {
      method,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
  return { root, media, dataDir, url, library, json };
}

test('serves the frontend, library, status and range streams', async (t) => {
  const { url, library } = await fixture(t);
  assert.equal(library.movies.length, 1);
  assert.equal(library.tvShows.length, 1);
  const status = await (await fetch(`${url}/api/status`)).json();
  assert.equal(status.status, 'online');
  assert.equal(status.port, Number(new URL(url).port));
  assert.equal(typeof status.ffmpegAvailable, 'boolean');
  assert.match(await (await fetch(url)).text(), /Orange TV/);
  const stream = await fetch(`${url}/api/stream/${library.movies[0].id}`, {
    headers: { Range: 'bytes=2-5' },
  });
  assert.equal(stream.status, 206);
  assert.equal(await stream.text(), '2345');
  const head = await fetch(`${url}/api/stream/${library.movies[0].id}`, {
    method: 'HEAD',
  });
  assert.equal(head.headers.get('content-length'), '10');
  assert.equal(await head.text(), '');
  assert.equal((await fetch(`${url}/api/missing`)).status, 404);
});

test('validates API input and responds with JSON errors', async (t) => {
  const { url, library, json } = await fixture(t);
  const id = library.movies[0].id;
  for (const payload of [{ extraMediaPaths: [123] }, {}, null, []]) {
    assert.equal((await json('/api/settings', payload)).status, 400);
  }
  for (const payload of [
    { title: 123 },
    { title: '' },
    { year: 'bad' },
    { year: {} },
    { rating: 99 },
    { genres: [1] },
    { posterUrl: 'javascript:alert(1)' },
  ]) {
    assert.equal(
      (await json(`/api/metadata/${id}`, payload, 'PUT')).status,
      400
    );
  }
  for (const currentTime of [-1, '10', null]) {
    assert.equal(
      (await json('/api/progress', { id, currentTime, duration: 100 })).status,
      400
    );
  }
  assert.equal(
    (await json('/api/progress', { id: 'missing', currentTime: 10 })).status,
    404
  );
  assert.equal(
    (await fetch(`${url}/api/stream/${id}?remux=true&t=bad`)).status,
    400
  );
  assert.equal((await fetch(`${url}/api/stream/missing`)).status, 404);
});

test('persists movie and episode progress and completes at 92 percent', async (t) => {
  const { url, library, json } = await fixture(t);
  const episode = library.tvShows[0].seasons[0].episodes[0];
  assert.equal(
    (
      await json('/api/progress', {
        id: episode.id,
        currentTime: 30,
        duration: 100,
      })
    ).status,
    200
  );
  const progress = await (
    await fetch(`${url}/api/progress?id=${episode.id}`)
  ).json();
  assert.equal(progress.currentTime, 30);
  const updated = await (await fetch(`${url}/api/library`)).json();
  assert.equal(updated.continueWatching[0].id, episode.id);
  await json('/api/progress', {
    id: episode.id,
    currentTime: 92,
    duration: 100,
  });
  assert.deepEqual(await (await fetch(`${url}/api/progress`)).json(), []);
  assert.equal(
    (await (await fetch(`${url}/api/progress?id=${episode.id}`)).json())
      .completed,
    true
  );
});

test('preserves metadata and views across rescans and concurrent requests', async (t) => {
  const { url, library, json } = await fixture(t);
  const id = library.movies[0].id;
  await json(
    `/api/metadata/${id}`,
    {
      title: 'Edited',
      overview: 'Saved',
      posterUrl: 'https://example.com/art.jpg',
    },
    'PUT'
  );
  await Promise.all(
    Array.from({ length: 8 }, () =>
      fetch(`${url}/api/view/${id}`, { method: 'POST' })
    )
  );
  await fetch(`${url}/api/library/rescan`, { method: 'POST' });
  const movie = (await (await fetch(`${url}/api/library`)).json()).movies[0];
  assert.equal(movie.title, 'Edited');
  assert.equal(movie.views, 8);
  assert.equal(movie.posterUrl, 'https://example.com/art.jpg');
});

test('rejects cross-origin access and encoded traversal, permits same-origin clients', async (t) => {
  const { url, library } = await fixture(t);
  assert.equal(
    (
      await fetch(`${url}/api/library`, {
        headers: { Origin: 'http://unrelated.example' },
      })
    ).status,
    403
  );
  assert.equal(
    (
      await fetch(`${url}/api/settings`, {
        method: 'OPTIONS',
        headers: {
          Origin: 'http://unrelated.example',
          'Access-Control-Request-Method': 'POST',
        },
      })
    ).status,
    403
  );
  assert.equal(
    (await fetch(`${url}/api/library`, { headers: { Origin: url } })).status,
    200
  );
  assert.equal(
    (await fetch(`${url}/api/backdrop/..%2f..%2fprivate`)).status,
    400
  );
  const poster = await (
    await fetch(`${url}/api/poster/${library.movies[0].id}`)
  ).text();
  assert.match(poster, /<svg/);
});

test('reports persistence failures without overwriting damaged user data', async (t) => {
  const { url, library, dataDir, json } = await fixture(t);
  const id = library.movies[0].id;
  const file = path.join(dataDir, 'metadata.json');
  fs.writeFileSync(file, '{broken');
  assert.equal(
    (await json(`/api/metadata/${id}`, { title: 'New' }, 'PUT')).status,
    500
  );
  assert.equal(fs.readFileSync(file, 'utf8'), '{broken');
  assert.equal(
    (await (await fetch(`${url}/api/library`)).json()).movies[0].title,
    library.movies[0].title
  );
});

test('settings persist across app instances and preserve disconnected records', async (t) => {
  const { url, library, media, dataDir, json } = await fixture(t);
  assert.equal(
    (await json('/api/settings', { extraMediaPaths: [] })).status,
    200
  );
  assert.equal(
    (await (await fetch(`${url}/api/library`)).json()).movies.length,
    0
  );
  assert.equal(
    (await (await fetch(`${url}/api/metadata`)).json()).movies[0].id,
    library.movies[0].id
  );
  assert.doesNotThrow(() => createApp({ dataDir, mediaPaths: [media] }));
  const settings = JSON.parse(
    fs.readFileSync(path.join(dataDir, 'settings.json'), 'utf8')
  );
  assert.deepEqual(settings.extraMediaPaths, []);
});
