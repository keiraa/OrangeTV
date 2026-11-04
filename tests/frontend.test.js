const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const publicDir = path.join(__dirname, '../public');
const html = fs.readFileSync(path.join(publicDir, 'index.html'), 'utf8');
const scripts = [...html.matchAll(/<script defer src="([^"]+)"/g)].map(
  (match) => match[1]
);

function browser() {
  const elements = new Map();
  function element(tag = 'div') {
    const classes = new Set();
    const listeners = new Map();
    const selectors = new Map();
    const value = {
      tagName: tag.toUpperCase(),
      children: [],
      style: {},
      dataset: {},
      value: '',
      isConnected: true,
      classList: {
        add: (...items) => items.forEach((item) => classes.add(item)),
        remove: (...items) => items.forEach((item) => classes.delete(item)),
        contains: (item) => classes.has(item),
        toggle: (item, force = !classes.has(item)) => {
          if (force) classes.add(item);
          else classes.delete(item);
          return force;
        },
      },
      addEventListener: (name, callback) => listeners.set(name, callback),
      listeners,
      setAttribute: (name, content) => {
        value[name] = content;
      },
      getAttribute: (name) => value[name],
      removeAttribute: (name) => {
        delete value[name];
      },
      appendChild: (child) => {
        value.children.push(child);
        return child;
      },
      replaceChildren: (...children) => {
        value.children = children;
      },
      querySelector: (selector) => {
        if (!selectors.has(selector))
          selectors.set(selector, element(selector));
        return selectors.get(selector);
      },
      querySelectorAll: (selector) =>
        selector === 'track'
          ? value.children.filter((child) => child.tagName === 'TRACK')
          : [],
      getClientRects: () => [{}],
      getBoundingClientRect: () => ({
        left: 0,
        top: 0,
        width: 100,
        height: 100,
      }),
      closest: () => null,
      contains: (other) => value.children.includes(other),
      matches: () => false,
      focus: () => {
        document.activeElement = value;
      },
      scrollIntoView: () => {},
    };
    if (tag === 'track') value.track = { mode: 'disabled' };
    return value;
  }
  const document = {
    getElementById: (id) => {
      if (!elements.has(id)) {
        const node = element();
        node.id = id;
        if (id.endsWith('Video'))
          Object.assign(node, {
            pause: () => {},
            load: () => {},
            play: () => Promise.resolve(),
          });
        elements.set(id, node);
      }
      return elements.get(id);
    },
    createElement: element,
    querySelectorAll: () => [],
    addEventListener: () => {},
    body: element('body'),
    activeElement: null,
  };
  document.activeElement = document.body;
  const mainVideo = document.getElementById('mainVideo');
  Object.assign(mainVideo, {
    duration: 100,
    currentTime: 0,
    volume: 0.5,
    paused: true,
    play: () => {
      mainVideo.paused = false;
      return Promise.resolve();
    },
    pause: () => {
      mainVideo.paused = true;
    },
    load: () => {},
  });
  for (const id of [
    'playerOverlay',
    'settingsModal',
    'detailModal',
    'trailerTheater',
    'cardPopoutPreview',
  ]) {
    document.getElementById(id).classList.add('pointer-events-none');
  }
  document.getElementById('subsMenu').classList.add('hidden');
  const window = {
    location: { href: 'http://localhost:3000/' },
    listeners: new Map(),
    addEventListener: (name, callback) => window.listeners.set(name, callback),
  };
  const context = vm.createContext({
    document,
    window,
    URL,
    console,
    alert: () => {},
    setInterval: () => 1,
    clearInterval: () => {},
    setTimeout: () => 1,
    clearTimeout: () => {},
  });
  for (const script of scripts)
    vm.runInContext(
      fs.readFileSync(path.join(publicDir, script), 'utf8'),
      context,
      { filename: script }
    );
  return { context, document, window, mainVideo, element };
}

test('loads each browser script once and resolves all HTML event handlers', () => {
  assert.equal(scripts.length, 5);
  assert.equal(new Set(scripts).size, scripts.length);
  assert.match(html, /<link rel="stylesheet" href="\/styles.css"/);
  const { context } = browser();
  for (const match of html.matchAll(/\bon(?:click|input)="([^"]+)"/g)) {
    const handler = match[1];
    assert.doesNotThrow(
      () => new vm.Script(`(function(event) { ${handler} })`)
    );
    for (const call of handler.matchAll(/(?<![.\w])([A-Za-z_$][\w$]*)\s*\(/g)) {
      if (call[1] !== 'if')
        assert.equal(typeof context[call[1]], 'function', call[1]);
    }
  }
});

test('escapes metadata text and rejects executable artwork URLs', () => {
  const { context } = browser();
  const card = context.createMediaCard(
    {
      id: 'movie',
      title: '<img src=x onerror=alert(1)>',
      part: '<script>alert(1)</script>',
      posterUrl: 'javascript:alert(1)',
      rating: '<svg onload=alert(1)>',
      genres: ['<b>genre</b>'],
    },
    true
  );
  assert.ok(card.innerHTML.includes('&lt;img'));
  assert.ok(card.innerHTML.includes('&lt;script'));
  assert.ok(!card.innerHTML.includes('<script>'));
  assert.equal(
    card.querySelector('img').src,
    'http://localhost:3000/api/poster/movie'
  );
  assert.equal(card.querySelector('img').alt, '<img src=x onerror=alert(1)>');
});

test('restores movie positions and selects the requested subtitle track', async () => {
  const { context, mainVideo } = browser();
  const requests = [];
  context.requestJson = async (url, options) => {
    requests.push({ url, options });
    return url.includes('/api/progress?id=')
      ? { currentTime: 42, completed: false }
      : { views: 1 };
  };
  await context.launchStream({
    id: 'movie',
    title: 'Movie',
    subtitles: [
      { id: 'en', label: 'English' },
      { id: 'fr', label: 'French' },
    ],
  });
  mainVideo.onloadedmetadata();
  assert.equal(mainVideo.currentTime, 42);
  context.setSubtitle('fr');
  assert.equal(mainVideo.children[0].track.mode, 'disabled');
  assert.equal(mainVideo.children[1].track.mode, 'showing');
  await context.saveCurrentProgress();
  assert.equal(
    requests.find((request) => request.url === '/api/progress').options.body
      .currentTime,
    42
  );
});

test('trailers neither fetch nor save movie progress or increment movie views', async () => {
  const { context } = browser();
  const requests = [];
  context.requestJson = async (url) => {
    requests.push(url);
    return null;
  };
  await context.launchTrailer({ id: 'movie', title: 'Movie' });
  await context.saveCurrentProgress();
  assert.deepEqual(requests, []);
});

test('a delayed older launch cannot replace the latest selected movie', async () => {
  const { context, mainVideo } = browser();
  let finishFirst;
  const delayed = new Promise((resolve) => {
    finishFirst = resolve;
  });
  context.requestJson = (url) =>
    url.includes('id=first') ? delayed : Promise.resolve({ views: 1 });
  const first = context.launchStream({ id: 'first', title: 'First' });
  await new Promise((resolve) => setImmediate(resolve));
  await context.launchStream({ id: 'second', title: 'Second' });
  finishFirst(null);
  await first;
  assert.equal(mainVideo.src, '/api/stream/second');
});

test('arrow keys choose nearby controls and playback keys seek and change volume', () => {
  const { context, document, window, mainVideo, element } = browser();
  const left = element('button');
  const right = element('button');
  right.getBoundingClientRect = () => ({
    left: 200,
    top: 0,
    width: 100,
    height: 100,
  });
  const scope = { querySelectorAll: () => [left, right] };
  document.activeElement = left;
  context.moveFocus('ArrowRight', scope);
  assert.equal(document.activeElement, right);
  document
    .getElementById('playerOverlay')
    .classList.remove('pointer-events-none');
  const keydown = window.listeners.get('keydown');
  keydown({
    key: 'ArrowRight',
    target: document.body,
    preventDefault: () => {},
  });
  assert.equal(mainVideo.currentTime, 10);
  keydown({ key: 'ArrowUp', target: document.body, preventDefault: () => {} });
  assert.equal(mainVideo.volume, 0.6);
});

test('HTTP failures reject instead of silently succeeding', async () => {
  const { context } = browser();
  context.fetch = async () => ({
    ok: false,
    status: 500,
    json: async () => ({ error: 'Disk full' }),
  });
  await assert.rejects(context.requestJson('/api/settings'), /Disk full/);
});

test('unavailable trailers use artwork and hidden overlays leave the accessibility tree', () => {
  const { context, document } = browser();
  context.openTrailerTheater({ id: 'movie', title: 'Movie', genres: [] });
  const theater = document.getElementById('trailerTheater');
  assert.equal(theater.inert, false);
  assert.equal(document.getElementById('theaterVideo').src, undefined);
  assert.equal(
    document.getElementById('theaterVideo').poster,
    'http://localhost:3000/api/poster/movie'
  );
  context.closeTrailerTheater();
  assert.equal(theater.inert, true);
  assert.equal(theater['aria-hidden'], 'true');
});
