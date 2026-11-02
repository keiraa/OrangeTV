# Repository guidance

## Project overview

Orange TV is a local media server for browsers and Smart TVs. It uses Node.js
18+, Express, CommonJS modules, and a vanilla JavaScript frontend. There is no
frontend build step.

## Code map

- `server/server.js`: Express routes, settings, catalog cache, metadata
  persistence, artwork endpoints, and startup.
- `server/scanner.js`: Recursive media discovery, filename parsing, stable
  path-based IDs, subtitles, artwork, and movie/show catalog construction.
- `server/streamer.js`: HTTP byte-range playback, optional FFmpeg remuxing, and
  subtitle serving.
- `server/progress.js`: JSON-backed playback history and continue watching.
- `server/utils.js`: LAN discovery, terminal QR banner, and SRT-to-WebVTT conversion.
- `public/index.html`: The entire UI, including inline CSS and JavaScript,
  playback controls, settings, and spatial navigation for TV remotes. Tailwind
  loads from a CDN.
- `data/`: Ignored runtime metadata, settings, watch history, and artwork.
  `data/.gitkeep` is tracked.

## Setup and commands

- Install dependencies with `npm ci` using the committed `package-lock.json`.
- Run `npm start`; the default URL is `http://localhost:3000`.
- On macOS, `npm run start:caffeinate` keeps the machine awake.
- An optional root `.env` accepts `PORT` and comma-separated `EXTRA_MEDIA_PATHS`.
  In-app settings also persist media paths in `data/settings.json`.
- FFmpeg is optional. The remux path copies video and encodes AAC audio; direct
  streaming works without FFmpeg.
- Startup listens on `0.0.0.0`, scans configured media folders, and writes catalog
  metadata. Use disposable media/data when checking changes to persistence.
- There are no configured build, lint, or automated test scripts.

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
- The server contains a hardcoded legacy media path. Use configured paths for
  local setup rather than adding another machine-specific path.

## Validation

- For backend edits, run `node --check` on each changed JavaScript file.
- For behavior changes, use a focused regression check with temporary fixtures;
  no test framework is currently installed.
- With the server running, check `/api/status` and `/api/library` and exercise the
  affected flow. Playback changes need range seeking, subtitles, and resume checks;
  UI changes need arrow-key, Enter, and Back/Escape navigation checks.
- Report checks actually run and any unavailable runtime or hardware validation.
