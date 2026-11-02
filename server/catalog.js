const fs = require('fs');
const path = require('path');
const { scanLibrary } = require('./scanner');
const { readJson, writeJson } = require('./json-store');

const EDITABLE_FIELDS = [
  'title',
  'year',
  'overview',
  'rating',
  'genres',
  'posterUrl',
  'backdropUrl',
  'views',
  'series',
  'seriesOrder',
  'part',
];

function* catalogItems(catalog) {
  yield* catalog.movies;
  for (const show of catalog.tvShows) {
    yield show;
    for (const season of show.seasons || []) yield* season.episodes;
  }
  for (const series of catalog.movieSeries || []) yield* series.movies;
}

function validCatalog(value) {
  if (
    !value ||
    typeof value !== 'object' ||
    Array.isArray(value) ||
    (!Array.isArray(value.movies) && !Array.isArray(value.tvShows))
  )
    return false;
  if (
    (value.movies !== undefined && !Array.isArray(value.movies)) ||
    (value.tvShows !== undefined && !Array.isArray(value.tvShows)) ||
    (value.movieSeries !== undefined && !Array.isArray(value.movieSeries))
  )
    return false;
  const catalog = { movies: [], tvShows: [], ...value };
  if (
    !catalog.tvShows.every(
      (show) =>
        show &&
        Array.isArray(show.seasons) &&
        show.seasons.every((season) => season && Array.isArray(season.episodes))
    )
  )
    return false;
  if (
    !(catalog.movieSeries || []).every(
      (series) => series && Array.isArray(series.movies)
    )
  )
    return false;
  return [...catalogItems(catalog)].every(
    (item) =>
      item &&
      typeof item.id === 'string' &&
      /^[\w-]{1,128}$/.test(item.id) &&
      typeof item.title === 'string' &&
      (item.views === undefined ||
        (Number.isFinite(item.views) && item.views >= 0)) &&
      (item.genres === undefined ||
        (Array.isArray(item.genres) &&
          item.genres.every((genre) => typeof genre === 'string'))) &&
      (item.subtitles === undefined ||
        (Array.isArray(item.subtitles) &&
          item.subtitles.every(
            (sub) =>
              sub && typeof sub.id === 'string' && typeof sub.path === 'string'
          ))) &&
      [
        'filePath',
        'localPoster',
        'localBackdrop',
        'trailerPath',
        'posterUrl',
        'backdropUrl',
      ].every(
        (key) =>
          item[key] === null ||
          item[key] === undefined ||
          typeof item[key] === 'string'
      )
  );
}

function mergeMedia(fresh, previous) {
  const result = { ...previous, ...fresh };
  for (const key of EDITABLE_FIELDS) {
    if (previous && Object.hasOwn(previous, key)) result[key] = previous[key];
  }
  result.views ??= 0;
  result.genres ??= [fresh.type === 'tv' ? 'TV Series' : 'Movie'];
  result.posterUrl ||= `/api/poster/${fresh.id}`;
  result.backdropUrl ||= `/api/backdrop/${fresh.id}`;
  return result;
}

class Catalog {
  constructor(file, roots) {
    this.file = file;
    this.roots = roots;
    const stored = readJson(file, null, validCatalog);
    this.stored = {
      movies: [],
      tvShows: [],
      movieSeries: [],
      scannedAt: null,
      ...stored,
    };
    if (stored) this.rebuild();
    else this.refresh();
  }

  resolveFile(file) {
    if (typeof file !== 'string') return null;
    try {
      const resolved = fs.realpathSync(file);
      const allowed = this.realRoots.some((root) => {
        const relative = path.relative(root, resolved);
        return (
          relative === '' ||
          (relative !== '..' &&
            !relative.startsWith(`..${path.sep}`) &&
            !path.isAbsolute(relative))
        );
      });
      if (!allowed || !fs.statSync(resolved).isFile()) return null;
      fs.accessSync(resolved, fs.constants.R_OK);
      return resolved;
    } catch {
      return null;
    }
  }

  rebuild() {
    this.realRoots = this.roots.flatMap((root) => {
      try {
        return [fs.realpathSync(root)];
      } catch {
        return [];
      }
    });
    const movies = this.stored.movies.filter((movie) =>
      this.resolveFile(movie.filePath)
    );
    const tvShows = this.stored.tvShows
      .map((show) => ({
        ...show,
        seasons: show.seasons
          .map((season) => ({
            ...season,
            episodes: season.episodes
              .filter((episode) => this.resolveFile(episode.filePath))
              .map((episode) => ({
                ...episode,
                posterUrl:
                  episode.posterUrl ||
                  show.posterUrl ||
                  `/api/poster/${show.id}`,
                backdropUrl:
                  episode.backdropUrl ||
                  show.backdropUrl ||
                  `/api/backdrop/${show.id}`,
              })),
          }))
          .filter((season) => season.episodes.length),
      }))
      .filter((show) => show.seasons.length);
    this.active = {
      movies,
      tvShows,
      movieSeries: [],
      scannedAt: this.stored.scannedAt,
    };
    this.items = new Map(
      [...catalogItems(this.active)].map((item) => [item.id, item])
    );
    this.active.movieSeries = this.stored.movieSeries
      .map((series) => ({
        ...series,
        movies: series.movies.flatMap((movie) => {
          const canonical = this.items.get(movie.id);
          if (canonical) return [{ ...movie, ...canonical }];
          if (!this.resolveFile(movie.filePath)) return [];
          this.items.set(movie.id, movie);
          return [movie];
        }),
      }))
      .filter((series) => series.movies.length);
    this.subtitles = new Map();
    for (const item of this.items.values()) {
      for (const sub of item.subtitles || [])
        this.subtitles.set(sub.id, sub.path);
    }
  }

  refresh(roots = this.roots) {
    const scanned = scanLibrary(roots);
    const previous = new Map();
    for (const item of catalogItems(this.stored)) {
      if (!previous.has(item.id)) previous.set(item.id, item);
    }
    const scannedIds = new Set(
      [...catalogItems({ ...scanned, movieSeries: [] })].map((item) => item.id)
    );
    const movies = scanned.movies.map((movie) =>
      mergeMedia(movie, previous.get(movie.id))
    );
    // Retain unavailable records on disk so unplugging a drive never erases its edits.
    movies.push(
      ...this.stored.movies.filter((movie) => !scannedIds.has(movie.id))
    );
    const tvShows = scanned.tvShows.map((show) => {
      const oldShow = previous.get(show.id);
      const merged = mergeMedia(show, oldShow);
      merged.seasons = show.seasons.map((season) => ({
        ...season,
        episodes: season.episodes.map((episode) => {
          const result = mergeMedia(episode, previous.get(episode.id));
          if (!previous.get(episode.id)?.posterUrl)
            result.posterUrl = merged.posterUrl;
          if (!previous.get(episode.id)?.backdropUrl)
            result.backdropUrl = merged.backdropUrl;
          return result;
        }),
      }));
      for (const oldSeason of oldShow?.seasons || []) {
        const missing = oldSeason.episodes.filter(
          (episode) => !scannedIds.has(episode.id)
        );
        const current = merged.seasons.find(
          (season) => season.seasonNumber === oldSeason.seasonNumber
        );
        if (current) current.episodes.push(...missing);
        else if (missing.length)
          merged.seasons.push({ ...oldSeason, episodes: missing });
      }
      merged.seasons.sort((a, b) => a.seasonNumber - b.seasonNumber);
      for (const season of merged.seasons)
        season.episodes.sort((a, b) => a.episode - b.episode);
      return merged;
    });
    tvShows.push(
      ...this.stored.tvShows
        .filter((show) => !scannedIds.has(show.id))
        .map((show) => ({
          ...show,
          seasons: show.seasons
            .map((season) => ({
              ...season,
              episodes: season.episodes.filter(
                (episode) => !scannedIds.has(episode.id)
              ),
            }))
            .filter((season) => season.episodes.length),
        }))
        .filter((show) => show.seasons.length)
    );
    const next = { ...this.stored, movies, tvShows, scannedAt: Date.now() };
    writeJson(this.file, next, validCatalog);
    this.stored = next;
    this.roots = roots;
    this.rebuild();
  }

  update(id, changes) {
    const next = structuredClone(this.stored);
    for (const item of catalogItems(next)) {
      if (item.id === id) Object.assign(item, changes);
    }
    writeJson(this.file, next, validCatalog);
    this.stored = next;
    this.rebuild();
    return this.items.get(id);
  }
}

module.exports = { Catalog };
