# Repository guidance

## Project overview

Orange TV is a local media server for browsers and Smart TVs. It uses Node.js
18+, Express, CommonJS modules, and a vanilla JavaScript frontend. There is no
frontend build step.

## Code map

- `server/server.js`: Startup, Express routes, settings, input validation, and HTTP errors.
- `server/catalog.js`: Catalog merging, metadata edits, available-media indexes, and root containment.
- `server/json-store.js`: Validated JSON reads and atomic writes shared by settings, metadata, and progress.
- `server/scanner.js`: Recursive media discovery, filename parsing, stable
  path-based IDs, subtitles, artwork, and movie/show catalog construction.
- `server/streamer.js`: HTTP byte-range playback, optional FFmpeg remuxing, and
  subtitle serving.
- `server/progress.js`: JSON-backed playback history and continue watching.
- `server/utils.js`: LAN discovery, terminal QR banner, and SRT-to-WebVTT conversion.
- `public/index.html`: Page markup. `public/styles.css` contains custom styles.
- `public/js/`: Deferred classic scripts for app/settings, library rendering, previews, playback, and remote navigation. Their global/exported comments document cross-file names. Tailwind loads from a CDN.
- `tests/`: Built-in Node test runner, temporary fixture data, and controlled FFmpeg processes.
- `data/`: Ignored runtime metadata, settings, watch history, and artwork.
  `data/.gitkeep` is tracked.

## Setup and commands

- Use Node 24+ for development tools; application runtime support remains Node 18+.
- Install development dependencies with `npm ci` using the committed lockfile. Use `npm ci --omit=dev` for production.
- Run `npm start`; the default URL is `http://localhost:3000`.
- On macOS, `npm run start:caffeinate` keeps the machine awake.
- An optional root `.env` accepts `PORT` and comma-separated `EXTRA_MEDIA_PATHS`.
  In-app settings also persist media paths in `data/settings.json`.
- FFmpeg is optional. The remux path copies video and encodes AAC audio; direct
  streaming works without FFmpeg.
- Startup listens on `0.0.0.0` and loads stored metadata or scans configured folders. Use disposable media/data when checking persistence.
- Run `npm test`, `npm run lint`, `npm run format:check`, and `npm run knip`.
- `npm run lint:fix` and `npm run format` apply reviewed cleanup. Formatting excludes runtime data. There is no build step.

## Change conventions

- Match the existing two-space indentation, semicolons, single-quoted JavaScript
  strings, and CommonJS `require`/`module.exports` style.
- Keep changes within the existing modules; prefer existing helpers and installed
  dependencies before adding packages or a framework.
- Update both Express routes and frontend consumers when changing API payloads.
- Preserve HTTP range seeking, subtitle conversion, resume tracking, and keyboard
  and TV-remote navigation when modifying related behavior.
- Preserve existing metadata and playback history during rescans. Media IDs depend
  on paths, so changes to ID generation affect stored progress and references.
- Do not commit personal media, `.env`, runtime JSON, or cached artwork. Do not
  replace user settings or scan unrelated personal directories for testing.
- Use explicit configured media paths; do not add machine-specific defaults.
- JSON formats and paths are retained. Invalid existing JSON must never be replaced with empty defaults.
- Run one process per data directory. Browser cross-origin requests are rejected; this remains an unauthenticated LAN application.

## Validation

- For backend edits, run `node --check` on each changed JavaScript file.
- Add focused behavior regressions with the built-in Node test runner and temporary fixtures. Never use personal media/data as fixtures.
- Preserve the deferred script order and test HTML event-handler references when editing frontend boundaries.
- With the server running, check `/api/status` and `/api/library` and exercise the
  affected flow. Playback changes need range seeking, subtitles, and resume checks;
  UI changes need arrow-key, Enter, and Back/Escape navigation checks.
- Report checks actually run and any unavailable runtime or hardware validation.
