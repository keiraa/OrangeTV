const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { readJson, writeJson } = require('../server/json-store');
const {
  getContinueWatching,
  getItemProgress,
  updateProgress,
  deleteProgress,
} = require('../server/progress');

function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'orangetv-store-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  return path.join(root, 'progress.json');
}

test('creates missing JSON files and preserves the old file on failed replacement', (t) => {
  const file = fixture(t);
  const valid = (value) =>
    value !== null && typeof value === 'object' && !Array.isArray(value);
  assert.deepEqual(readJson(file, {}, valid), {});
  writeJson(file, { count: 1 }, valid);
  assert.deepEqual(readJson(file, null, valid), { count: 1 });
  assert.throws(() => writeJson(file, [], valid), /Refusing invalid/);
  assert.deepEqual(readJson(file, null, valid), { count: 1 });
  assert.deepEqual(fs.readdirSync(path.dirname(file)), ['progress.json']);
});

test('never overwrites malformed JSON or a malformed progress shape', (t) => {
  const file = fixture(t);
  for (const content of ['{"broken":', 'null', '[]', '{"item":null}']) {
    fs.writeFileSync(file, content);
    assert.throws(
      () => updateProgress({ id: 'a', currentTime: 12, duration: 100 }, file),
      /Invalid/
    );
    assert.equal(fs.readFileSync(file, 'utf8'), content);
  }
});

test('stores resume positions, filters completed media, and deletes only the selected record', (t) => {
  const file = fixture(t);
  updateProgress({ id: 'a', currentTime: 30, duration: 100, season: 0 }, file);
  updateProgress({ id: 'b', currentTime: 92, duration: 100 }, file);
  assert.equal(getItemProgress('a', file).season, 0);
  assert.equal(getItemProgress('b', file).completed, true);
  assert.deepEqual(
    getContinueWatching(20, file).map((item) => item.id),
    ['a']
  );
  assert.equal(deleteProgress('a', file), true);
  assert.equal(getItemProgress('a', file), null);
  assert.equal(deleteProgress('missing', file), false);
  assert.ok(getItemProgress('b', file));
});

test('rejects invalid times and safely stores object-property names', (t) => {
  const file = fixture(t);
  for (const currentTime of [-1, NaN, Infinity, '12']) {
    assert.equal(updateProgress({ id: 'a', currentTime }, file), null);
  }
  assert.equal(fs.existsSync(file), false);
  updateProgress({ id: '__proto__', currentTime: 20, duration: 100 }, file);
  assert.equal(getItemProgress('__proto__', file).currentTime, 20);
  assert.equal(getItemProgress('toString', file), null);
});

test('serializes simultaneous updates in one process without losing other records', async (t) => {
  const file = fixture(t);
  await Promise.all(
    Array.from({ length: 25 }, (_, i) =>
      Promise.resolve().then(() => {
        updateProgress(
          { id: String(i), currentTime: 10 + i, duration: 100 },
          file
        );
      })
    )
  );
  assert.equal(getContinueWatching(100, file).length, 25);
  assert.deepEqual(fs.readdirSync(path.dirname(file)), ['progress.json']);
});
