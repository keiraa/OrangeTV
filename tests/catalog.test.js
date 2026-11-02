const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { Catalog } = require('../server/catalog');

function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'orangetv-catalog-'));
  const media = path.join(root, 'media');
  fs.mkdirSync(media);
  fs.writeFileSync(path.join(media, 'Movie (2020).mp4'), 'video');
  fs.writeFileSync(path.join(media, 'Show S01E01.mp4'), 'episode');
  const file = path.join(root, 'data/metadata.json');
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  return { root, media, file, catalog: new Catalog(file, [media]) };
}

test('preserves movie and episode edits, artwork URLs, views and collections across rescans', (t) => {
  const { catalog, file } = fixture(t);
  const movie = catalog.active.movies[0];
  const episode = catalog.active.tvShows[0].seasons[0].episodes[0];
  catalog.update(movie.id, {
    title: 'My title',
    posterUrl: 'https://example.com/art.jpg',
    views: 7,
  });
  catalog.update(episode.id, {
    title: 'My episode',
    overview: 'Episode notes',
    views: 3,
  });
  const stored = JSON.parse(fs.readFileSync(file, 'utf8'));
  stored.movieSeries = [
    {
      title: 'Collection',
      movies: [{ ...stored.movies[0], views: 0, part: 'Part 1' }],
    },
  ];
  fs.writeFileSync(file, JSON.stringify(stored));
  const reloaded = new Catalog(file, catalog.roots);
  reloaded.refresh();
  assert.equal(reloaded.items.get(movie.id).title, 'My title');
  assert.equal(
    reloaded.items.get(movie.id).posterUrl,
    'https://example.com/art.jpg'
  );
  assert.equal(reloaded.items.get(movie.id).views, 7);
  assert.equal(reloaded.items.get(episode.id).overview, 'Episode notes');
  assert.equal(reloaded.items.get(episode.id).views, 3);
  assert.equal(reloaded.active.movieSeries[0].movies[0].views, 7);
  assert.equal(reloaded.active.movieSeries[0].movies[0].part, 'Part 1');
});

test('keeps unavailable metadata on disk but hides it from the active library', (t) => {
  const { catalog, media, file } = fixture(t);
  const movie = catalog.active.movies[0];
  catalog.update(movie.id, { overview: 'Keep this edit' });
  const disconnected = `${media}-disconnected`;
  fs.renameSync(media, disconnected);
  catalog.refresh();
  assert.equal(catalog.active.movies.length, 0);
  assert.equal(catalog.stored.movies[0].overview, 'Keep this edit');
  assert.ok(JSON.parse(fs.readFileSync(file, 'utf8')).movies.length);
  fs.renameSync(disconnected, media);
  catalog.refresh();
  assert.equal(catalog.items.get(movie.id).overview, 'Keep this edit');
  catalog.refresh([]);
  assert.equal(catalog.items.size, 0);
  assert.equal(catalog.stored.movies.length, 1);
});

test('refuses paths outside configured roots, including symlinks and prefix siblings', (t) => {
  const { catalog, root, media } = fixture(t);
  const outside = path.join(root, 'media-other');
  fs.mkdirSync(outside);
  const file = path.join(outside, 'private.mp4');
  fs.writeFileSync(file, 'private');
  fs.symlinkSync(file, path.join(media, 'link.mp4'));
  assert.equal(catalog.resolveFile(file), null);
  assert.equal(catalog.resolveFile(path.join(media, 'link.mp4')), null);
  assert.equal(catalog.resolveFile(media), null);
});

test('failed persistence leaves the in-memory catalog and malformed file untouched', (t) => {
  const { catalog, file } = fixture(t);
  const movie = catalog.active.movies[0];
  fs.writeFileSync(file, '{broken');
  assert.throws(
    () => catalog.update(movie.id, { title: 'Lost write' }),
    /Invalid JSON/
  );
  assert.equal(catalog.items.get(movie.id).title, movie.title);
  assert.equal(fs.readFileSync(file, 'utf8'), '{broken');
  assert.throws(() => new Catalog(file, catalog.roots), /Invalid JSON/);
});

test('normalizes a legacy catalog with an omitted empty top-level collection', (t) => {
  const { file, media } = fixture(t);
  fs.writeFileSync(file, JSON.stringify({ movies: [] }));
  assert.deepEqual(new Catalog(file, [media]).active.tvShows, []);
});
