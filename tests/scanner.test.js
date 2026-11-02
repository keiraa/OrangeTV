const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {
  scanLibrary,
  parseMediaInfo,
  generateId,
} = require('../server/scanner');

function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'orangetv-scan-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  return root;
}

test('parses dotted movie and episode names without stripping titles', () => {
  assert.deepEqual(parseMediaInfo('Dune.Part.Two.2024.1080p.mkv', 'Movies'), {
    type: 'movie',
    title: 'Dune Part Two',
    year: 2024,
  });
  assert.deepEqual(parseMediaInfo('Breaking.Bad.S01E02.mp4', 'Season 1'), {
    type: 'tv',
    showTitle: 'Breaking Bad',
    season: 1,
    episode: 2,
    episodeTitle: 'Episode 2',
  });
  assert.equal(
    parseMediaInfo('www.example.com - Arrival (2016).mp4', 'Movies').title,
    'Arrival'
  );
  assert.equal(
    parseMediaInfo('Show Season 2 Episode 3.mp4', 'Show').episode,
    3
  );
  assert.equal(parseMediaInfo('Show.2x03.mp4', 'Show').episode, 3);
});

test('scans supported formats recursively, ignores hidden files and trailers', (t) => {
  const root = fixture(t);
  fs.mkdirSync(path.join(root, 'nested'));
  for (const ext of ['mp4', 'mkv', 'webm', 'm4v', 'mov', 'avi']) {
    fs.writeFileSync(path.join(root, 'nested', `Movie ${ext}.${ext}`), 'video');
  }
  fs.writeFileSync(path.join(root, '.hidden.mp4'), 'hidden');
  fs.writeFileSync(path.join(root, 'trailer.mp4'), 'trailer');
  fs.writeFileSync(path.join(root, 'notes.txt'), 'text');
  const result = scanLibrary([root]);
  assert.equal(result.movies.length, 6);
  assert.deepEqual(result.tvShows, []);
  assert.equal(result.movies[0].id, generateId(result.movies[0].filePath));
});

test('deduplicates overlapping roots and handles missing directories', (t) => {
  const root = fixture(t);
  const child = path.join(root, 'nested');
  fs.mkdirSync(child);
  fs.writeFileSync(path.join(child, 'Movie.mp4'), 'video');
  assert.equal(
    scanLibrary([root, child, root, path.join(root, 'missing')]).movies.length,
    1
  );
});

test('matches subtitles to their video and picks explicit artwork', (t) => {
  const root = fixture(t);
  const folder = path.join(root, 'Movie');
  fs.mkdirSync(folder);
  for (const name of [
    'Movie.mp4',
    'Other.mp4',
    'Movie.en.srt',
    'Other.en.srt',
    'backdrop.jpg',
    'poster.jpg',
  ]) {
    fs.writeFileSync(path.join(folder, name), 'fixture');
  }
  const movie = scanLibrary([root]).movies.find(
    (item) => item.filename === 'Movie.mp4'
  );
  assert.deepEqual(
    movie.subtitles.map((sub) => sub.filename),
    ['Movie.en.srt']
  );
  assert.equal(movie.localPoster, path.join(folder, 'poster.jpg'));
  assert.equal(movie.localBackdrop, path.join(folder, 'backdrop.jpg'));
});

test('sorts episodes and skips directory symlinks', (t) => {
  const root = fixture(t);
  fs.writeFileSync(path.join(root, 'Show S02E03.mp4'), 'video');
  fs.writeFileSync(path.join(root, 'Show S01E02.mp4'), 'video');
  fs.symlinkSync(root, path.join(root, 'loop'), 'dir');
  const show = scanLibrary([root]).tvShows[0];
  assert.deepEqual(
    show.seasons.map((season) => season.seasonNumber),
    [1, 2]
  );
});
