# Refactoring record

## Baseline

The read-only audit found range parsing errors, unhandled stream failures,
unsafe JSON replacement, lost metadata during rescans, unsafe HTML interpolation,
unrestricted cross-origin management access, and incomplete resume/remote controls.

Checks run before application edits:

- Scanner regression tests: 2 passed, 3 failed (filename parsing, duplicate roots,
  subtitle association).
- Streaming regression tests: 3 passed, 2 failed (suffix/invalid ranges).
- ESLint: 24 findings. Most frontend unused-function reports were references from
  HTML event attributes; those require explicit integration rather than deletion.
- Prettier: 10 files needed formatting, including newly added checks.
- Knip: one unused export, `getLocalIpAddresses`.

The application initially had no tests or development-tool configuration.
Node 24 and Node 18 validation runtimes are downloaded to temporary directories;
application support remains Node 18+.

## Dependency decisions

All four production dependencies are used and retained. The existing Express 4
dependency ranges are preserved. Its transitive body-parser dependency receives
the compatible security patch reported by npm audit.

Knip, ESLint, and Prettier are development dependencies. The additional
eslint-plugin-html package extracts embedded scripts, and globals supplies
correct Node/browser global names. No test framework is added.

## Original and final architecture

Originally, `server/server.js` owned settings, JSON writes, catalog merges,
indexes, HTTP routes, and startup. `public/index.html` contained all markup,
custom CSS, and application JavaScript. Scanner, streamer, progress, and network
utilities were already separate modules.

The final structure preserves the flat backend and uses two additional modules:

- `catalog.js` owns catalog state, metadata preservation, indexes, and media-root
  containment. Its instances let tests use isolated data without global state.
- `json-store.js` supplies validated reads and atomic replacement, shared by
  settings, metadata, and progress. There is no database or repository layer.
- `server.js` owns HTTP validation, settings, startup, and error responses.
  Importing it no longer starts a listener or scans personal folders.
- Scanner and streamer remain in their existing locations. There are no router,
  controller, service, dependency-injection, or build-system layers.

The frontend is split into:

```text
public/
├── index.html          # Existing page markup
├── styles.css          # Existing custom styles
└── js/
    ├── app.js          # HTTP/error helpers, settings, initialization
    ├── library.js      # Catalog index, rendering, search, details, tabs
    ├── previews.js     # Hover previews and trailer theater
    ├── player.js       # Playback, seeking, subtitles, saved progress
    └── navigation.js   # Focus, keyboard and TV remote behavior
```

Classic scripts load in explicit deferred order. Shared names are documented in
ESLint `global`/`exported` comments, and tests check loading and HTML handler
references. There is no module loader, framework, bundler, or TypeScript.

## Correctness and cleanup

- Direct streaming validates ranges, supports suffix/open ranges, clamps ends,
  produces 206/416 headers, handles empty files and HEAD requests, and keeps
  memory bounded with file streams. Multiple ranges are deliberately rejected.
- Missing/inaccessible files and read failures produce controlled responses;
  response closure cleans up file streams and remux processes.
- FFmpeg checks are shared across concurrent requests. Remux errors are handled
  before and after output begins; video copy and AAC audio behavior is retained.
- JSON writes validate both existing and replacement contents, flush the
  temporary file, and rename it atomically. Failed writes propagate to callers.
  An interrupted-write test confirms that the prior JSON stays intact.
- Rescans preserve edited movie/episode fields, artwork URLs, view counts, and
  collections. Unavailable records remain stored but are excluded from browsing.
- The scanner fixes dotted filenames and long episode notation, deduplicates
  overlapping paths, indexes sidecars by directory, and skips individual
  unreadable files/directories. Explicit artwork and matching subtitle names take
  precedence over unrelated files.
- Streaming resolves catalog IDs and checks canonical paths against configured
  roots, including symlink escapes. Artwork fallback IDs cannot traverse paths.
- API input is checked before mutation, errors are returned consistently, and
  cross-origin browser requests are rejected. No authentication system was added.
- Dynamic card/episode/collection text is escaped; image/background URLs use
  browser properties and validated HTTP(S) URLs. SVG text is escaped.
- A single frontend media index replaces repeated list reconstruction and
  includes episodes. Continue Watching restores saved positions.
- Trailers do not save movie progress or increment movie views. Progress saves
  are ordered; stale playback launches cannot replace newer selections.
- Subtitle selection enables the chosen track. Player state follows media
  events; invalid-duration seeks are ignored.
- Keyboard focus handles cards, episodes, overlays, Tab, Back, playback, volume,
  and fullscreen. Hidden overlays are inert and excluded from accessibility
  navigation while preserving their visual transitions.
- Missing optional preview trailers keep artwork instead of repeatedly requesting
  a missing file. Preview/theater timers and the existing visual design remain.

Important removals:

- Removed unreferenced `openDetailsById` and `openTrailerTheaterById` after checking
  repository and HTML references.
- Removed the unused `getLocalIpAddresses` export; its implementation remains in
  use by LAN discovery.
- Reused `getItemProgress` for position lookup instead of deleting it.
- Removed duplicated `isPlaying` state, unreachable artwork fallback expressions,
  repeated media lookup construction, and the hardcoded legacy media folder.
- No source files, user data, secrets, settings, supported formats, or API route
  families were deleted. Existing backend modules were not moved.

## Dependency and tool versions

| Package            | Installed version | Scope                                            |
| ------------------ | ----------------- | ------------------------------------------------ |
| Express            | 4.22.3            | Existing runtime dependency                      |
| CORS               | 2.8.6             | Existing runtime dependency                      |
| dotenv             | 16.6.1            | Existing runtime dependency                      |
| qrcode-terminal    | 0.12.0            | Existing runtime dependency                      |
| body-parser        | 1.20.9            | Compatible transitive security patch from 1.20.8 |
| Knip               | 6.44.1            | Development                                      |
| ESLint             | 10.14.0           | Development                                      |
| Prettier           | 3.9.10            | Development                                      |
| eslint-plugin-html | 8.2.1             | Development; embedded script handling            |
| globals            | 16.5.0            | Development; Node/browser environments           |

All four direct production dependency ranges are unchanged. No runtime package
was added or removed. Knip/ESLint have a separately documented Node 24 development
requirement; `engines.node` remains `>=18` for the application.

The final npm advisory check reported **zero production vulnerabilities** and
**four moderate development advisories** involving minimatch in ESLint's dependency
tree. The installed supported ESLint release still uses the affected dependency
range. No forced downgrade, unverified override, or production major upgrade was
used to hide those findings. Recheck upstream releases before updating the tools.

## Configuration and commands

- `eslint.config.js`: focused correctness rules, separate CommonJS/browser global
  environments, and HTML script extraction. Formatting stays in Prettier.
- `knip.json`: explicit browser script entry files, test entries, backend/config
  project files, and the external macOS `caffeinate` command. The production entry
  is discovered from `package.json`. No broad finding suppression is used.
- `.prettierrc`: two spaces, semicolons by default, single-quoted JavaScript,
  trailing commas supported by ES5.
- `.prettierignore`: runtime data, node_modules, generated lockfile, caches,
  coverage, and build output.
- `.env.example`: PORT and optional media-path defaults, with no personal values.
- Added scripts: `lint`, `lint:fix`, `format`, `format:check`, `knip`, `test`.
  Existing `start` and `start:caffeinate` commands are unchanged.

Files created: `server/catalog.js`, `server/json-store.js`, `public/styles.css`,
the five `public/js/` files above, seven `tests/*.test.js` files, `.env.example`,
`eslint.config.js`, `knip.json`, `.prettierrc`, `.prettierignore`, and this report.

Files modified: `server/server.js`, `server/scanner.js`, `server/streamer.js`,
`server/progress.js`, `server/utils.js`, `public/index.html`, `package.json`,
`package-lock.json`, `README.md`, and the existing initialization `AGENTS.md`.
No files were deleted.

## Final validation

| Check                                                    | Result                                                          |
| -------------------------------------------------------- | --------------------------------------------------------------- |
| `npm run lint` and `npm run lint:fix`                    | Pass                                                            |
| `npm run format` and `npm run format:check`              | Pass                                                            |
| `npm run knip`                                           | Pass, no findings or configuration hints                        |
| `npm test`, Node 24.22.2                                 | 46 passed, 0 failed, 0 skipped                                  |
| `npm test`, Node 18.20.8                                 | 46 passed, 0 failed, 0 skipped                                  |
| Production-only `npm ci --omit=dev --offline`            | Pass in a disposable copy                                       |
| Actual `npm start`, Node 18 production-only installation | Pass                                                            |
| Health/library and every local frontend asset            | HTTP success                                                    |
| Startup with malformed metadata or invalid PORT          | Controlled failure; original data preserved                     |
| Chrome UI smoke check                                    | Page and design load; sample MP4 plays; subtitle choices appear |

Streaming tests include full/bounded/suffix/open ranges, invalid ranges, 206/416
headers, empty/missing/unreadable files, a sparse 5 GB file, read-stream failure,
and disconnect handling. API tests also check HEAD behavior.

Scanner tests include supported formats, recursion, missing directories,
permissions, duplicate roots, sidecar matching, episode order, and symlink loops.

Persistence tests cover missing/corrupt/malformed JSON, denied writes, interrupted
replacement, simultaneous updates within one process, completion filtering,
metadata edits, and disconnect/reconnect preservation.

Frontend tests cover actual script load order and HTML handlers, escaping and
artwork URLs, saved positions, track selection, trailer isolation, stale launches,
focus movement, playback keys, HTTP errors, and hidden overlay accessibility.
FFmpeg lifecycle tests use controlled child-process stand-ins for availability,
absence, success, spawn/exit failures, failure after partial output, and cleanup.
A real FFmpeg codec-conversion run was not possible because FFmpeg is not installed.

All automated tests used disposable fixture directories. The repository's
`data/` directory still contains only its original `.gitkeep`.

## Remaining limits

- Actual Smart TV hardware, other browsers, Windows/Linux, and narrow-screen
  responsive layouts were not manually verified. The browser smoke check is not
  a complete visual or device compatibility suite.
- FFmpeg command construction and lifecycle are tested; real remuxed playback
  still needs verification on a machine with FFmpeg and representative media.
- Four moderate development-only dependency advisories remain as described above.
- One server process per data directory is supported. Atomic replacement does not
  coordinate separate processes or create a transaction across settings/catalog.
- Scans and JSON writes remain synchronous. This is suitable for a personal
  library; profile real pauses before adding workers, queues, or more layers.
- Tailwind still loads from its existing CDN. Local streaming works offline;
  first-load styling depends on network access or cache.
- Media IDs remain path based. Moving a file gives it a new ID. Unavailable
  metadata is intentionally retained; no automatic purge or migration was added.
- Node was absent from the original shell. Validation used temporary official
  Node runtimes; install Node on PATH for ordinary future npm commands.
- Optional jscpd, a frontend build system, new application features, authentication,
  a database, and generic architectural layers were deliberately omitted.
