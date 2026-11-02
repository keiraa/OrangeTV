const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');
const express = require('express');
const { streamVideoDirect, streamSubtitle } = require('../server/streamer');

async function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'orangetv-stream-'));
  const file = path.join(root, 'sample.mp4');
  fs.writeFileSync(file, Buffer.from(Array.from({ length: 100 }, (_, i) => i)));
  fs.writeFileSync(
    path.join(root, 'sample.srt'),
    '1\r\n00:00:01,500 --> 00:00:02,500\r\nHello\r\n'
  );
  const app = express();
  app.get('/video', (req, res) => streamVideoDirect(req, res, file));
  app.get('/missing', (req, res) =>
    streamVideoDirect(req, res, path.join(root, 'missing.mp4'))
  );
  app.get('/subtitle', (req, res) =>
    streamSubtitle(req, res, path.join(root, 'sample.srt'))
  );
  const server = app.listen(0, '127.0.0.1');
  await new Promise((resolve) => server.once('listening', resolve));
  t.after(async () => {
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
    fs.rmSync(root, { recursive: true, force: true });
  });
  return { url: `http://127.0.0.1:${server.address().port}`, root, file };
}

test('serves full files and bounded ranges with correct headers and bytes', async (t) => {
  const { url } = await fixture(t);
  const full = await fetch(`${url}/video`);
  assert.equal(full.status, 200);
  assert.equal(full.headers.get('content-length'), '100');
  assert.equal((await full.arrayBuffer()).byteLength, 100);
  const range = await fetch(`${url}/video`, {
    headers: { Range: 'bytes=10-19' },
  });
  assert.equal(range.status, 206);
  assert.equal(range.headers.get('content-range'), 'bytes 10-19/100');
  assert.equal(range.headers.get('content-length'), '10');
  assert.equal(range.headers.get('accept-ranges'), 'bytes');
  assert.deepEqual(
    [...new Uint8Array(await range.arrayBuffer())],
    [10, 11, 12, 13, 14, 15, 16, 17, 18, 19]
  );
});

test('supports suffix and open ranges and clamps the last byte', async (t) => {
  const { url } = await fixture(t);
  for (const range of ['bytes=-10', 'bytes=90-', 'bytes=90-999']) {
    const response = await fetch(`${url}/video`, { headers: { Range: range } });
    assert.equal(response.status, 206, range);
    assert.equal(response.headers.get('content-range'), 'bytes 90-99/100');
    assert.equal((await response.arrayBuffer()).byteLength, 10);
  }
});

test('rejects invalid and unsatisfiable ranges without crashing', async (t) => {
  const { url } = await fixture(t);
  for (const range of [
    'bytes=100-',
    'bytes=20-10',
    'bytes=abc-def',
    'bytes=-0',
    'bytes=0-1,5-6',
    'items=0-1',
  ]) {
    const response = await fetch(`${url}/video`, { headers: { Range: range } });
    assert.equal(response.status, 416, range);
    assert.equal(response.headers.get('content-range'), 'bytes */100');
    await response.arrayBuffer();
  }
});

test('handles missing and empty files and converts SRT subtitles', async (t) => {
  const { url, file } = await fixture(t);
  assert.equal((await fetch(`${url}/missing`)).status, 404);
  const subtitle = await fetch(`${url}/subtitle`);
  assert.match(subtitle.headers.get('content-type'), /^text\/vtt/);
  assert.match(await subtitle.text(), /^WEBVTT\n\n1\n00:00:01\.500/);
  fs.truncateSync(file);
  const empty = await fetch(`${url}/video`);
  assert.equal(empty.status, 200);
  assert.equal((await empty.arrayBuffer()).byteLength, 0);
  assert.equal(
    (await fetch(`${url}/video`, { headers: { Range: 'bytes=0-' } })).status,
    416
  );
});

test('seeks near the end of a sparse multi-gigabyte file and survives disconnects', async (t) => {
  const { url, file } = await fixture(t);
  const size = 5 * 1024 ** 3;
  fs.truncateSync(file, size);
  const response = await fetch(`${url}/video`, {
    headers: { Range: `bytes=${size - 16}-` },
  });
  assert.equal(
    response.headers.get('content-range'),
    `bytes ${size - 16}-${size - 1}/${size}`
  );
  assert.equal((await response.arrayBuffer()).byteLength, 16);
  await new Promise((resolve, reject) => {
    const request = http.get(`${url}/video`, (res) => {
      res.once('data', () => {
        res.destroy();
        resolve();
      });
    });
    request.on('error', reject);
  });
  const alive = await fetch(`${url}/video`, {
    headers: { Range: 'bytes=0-0' },
  });
  assert.equal(alive.status, 206);
  await alive.arrayBuffer();
});
