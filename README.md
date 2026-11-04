# 🍊 OrangeTV

A lightweight local media server for browsers and Smart TVs. OrangeTV scans your
existing folders and streams files over your home network without copying them
or transcoding video.

The interface includes movie and TV browsing, search, local artwork, trailer
previews, keyboard/remote controls, subtitles, and saved playback positions.
Browser codec support determines which files can play directly.

## Requirements

- Application: Node.js **18+** and npm.
- Development tools: Node.js **24+**. This separate requirement does not raise the
  application's minimum runtime. npm on Node 18 may warn about omitted development
  packages during installation; the production server does not load those tools.
- Optional: FFmpeg on `PATH` for the remux endpoint.
- macOS, Linux, or Windows. The keep-awake script requires macOS `caffeinate`.

Install Node.js from [nodejs.org](https://nodejs.org/). Check your shell with
`node --version` and `npm --version` before installing dependencies.

## Run

```sh
npm ci --omit=dev
npm start
```

Open `http://localhost:3000`. The terminal prints a LAN address and QR code for
other devices on the same network. On macOS, keep the machine awake with:

```sh
npm run start:caffeinate
```

Open **Media Folders** in the navigation bar, add your media directories, and
save. There is no machine-specific default media folder.

## Configuration

Copy `.env.example` to `.env` if you want environment-based configuration:

```dotenv
PORT=3000
EXTRA_MEDIA_PATHS="/Volumes/Media/Movies,/Users/your-name/Movies"
```

`PORT` must be an integer from 0 to 65535; 0 requests an available port.
`EXTRA_MEDIA_PATHS` is a comma-separated list. Saved paths in `data/settings.json`
take precedence over the environment defaults. Paths support `~/` and relative
paths; absolute paths are clearer for external drives. A comma inside a path
cannot be represented by the environment variable; edit the settings JSON array
while the server is stopped if necessary.

Saving paths or clicking **Rescan Library** refreshes the catalog. Missing drives
and removed paths are hidden from browsing, while their metadata remains on disk
so reconnecting a drive does not erase edits. Changing a media file's path changes
its ID; existing progress remains associated with its previous ID.

## Media organization

```text
Movies/
├── Arrival (2016)/
│   ├── Arrival (2016).mp4
│   ├── Arrival (2016).en.srt
│   ├── Arrival (2016).fr.vtt
│   ├── poster.jpg
│   ├── backdrop.jpg
│   └── trailer.mp4
└── Another Movie (2020).mkv

TV Shows/
└── Example Show/
    ├── poster.jpg
    ├── backdrop.jpg
    └── Season 1/
        ├── Example.Show.S01E01.mp4
        └── Example.Show.S01E01.en.srt
```

- Videos: MP4, MKV, WebM, M4V, MOV, AVI.
- Subtitles: SRT and VTT. SRT is converted to WebVTT when requested.
- Artwork: JPG, JPEG, PNG, WebP. `images/poster.jpg` and `images/backdrop.jpg`
  inside a movie/show folder are also supported. Missing artwork gets a local
  SVG poster fallback.
- Episodes: `S01E02`, `Season 1 Episode 2`, or `1x02` in filenames.
- Name sidecars after their video to avoid assigning a subtitle to the wrong file.
- Existing `movieSeries` collections in metadata are preserved and displayed.
  The scanner does not automatically identify franchises.

Direct play depends on the browser's container and audio/video codec support.
An extension alone does not guarantee playback, especially on Smart TVs.

## Playback and controls

Unfinished videos resume automatically once a saved position is over five
seconds. Videos watched to at least 92% are considered complete. Trailers do not
change movie progress or view counts. Select an episode in its show's details.

| Action                         | Keyboard / remote                                           |
| ------------------------------ | ----------------------------------------------------------- |
| Move between browsing controls | Arrow keys; Tab / Shift+Tab                                 |
| Activate focused control       | Enter / OK                                                  |
| Close overlay                  | Escape, Browser Back, remote Back; Backspace outside inputs |
| Play / pause                   | Space or media play/pause; Enter on the play button         |
| Seek during playback           | Left / Right, 10 seconds                                    |
| Volume during playback         | Up / Down                                                   |
| Fullscreen during playback     | F or the fullscreen button                                  |

Use a TV's browser to open the printed LAN URL. Actual remote key mappings and
codec support vary by device. Touch and mouse controls remain available.

## Optional FFmpeg

Install FFmpeg through your operating system's package manager (for example,
`brew install ffmpeg` on macOS), then verify `ffmpeg -version` in the shell that
starts OrangeTV. Restart OrangeTV after changing FFmpeg availability.

`GET /api/stream/:id?remux=true&t=30` copies video into fragmented MP4 and encodes
AAC audio, starting at 30 seconds. It does not transcode video. Remux responses
have no byte-range seeking; change `t` to request another start position. When
FFmpeg is absent, the endpoint falls back to direct playback. The browser player
uses direct play by default.

## Architecture and data

The backend remains Express 4 with CommonJS; the frontend uses ordinary deferred
scripts without a bundler. See [AGENTS.md](AGENTS.md) for the file map and
[the refactoring record](docs/refactoring.md) for changes and validation.

| Module                             | Responsibility                                                             |
| ---------------------------------- | -------------------------------------------------------------------------- |
| `server/server.js`                 | Startup, routes, request validation, settings, HTTP errors                 |
| `server/catalog.js`                | Catalog merging, available-media indexes, metadata edits, root containment |
| `server/scanner.js`                | Discovery, filename parsing, subtitles and artwork association             |
| `server/streamer.js`               | File streams, ranges, subtitle responses, optional FFmpeg                  |
| `server/progress.js`               | Resume records and completion rules                                        |
| `server/json-store.js`             | Validated JSON reads and atomic file replacement                           |
| `server/utils.js`                  | LAN address, QR banner, SRT conversion                                     |
| `public/index.html` / `styles.css` | Markup / custom styles                                                     |
| `public/js/`                       | App/settings, library, previews, player, navigation                        |

Runtime files remain in `data/`, excluded from Git:

- `settings.json`: media folders.
- `metadata.json`: catalog, artwork references, collections, and edits.
- `progress.json`: playback positions and completion status.
- `images/`: optional local artwork cache.

Writes use a temporary file and atomic rename. Malformed or unreadable existing
JSON is preserved and reported as an error. Run only **one server process per
data directory**; cross-process writes are not coordinated. A failed settings
rescan is reported, but the already-saved settings remain available for a retry.

## API

| Endpoints                                                        | Purpose                                |
| ---------------------------------------------------------------- | -------------------------------------- |
| `GET /api/library`, `POST /api/library/rescan`                   | Browse / rescan available media        |
| `GET /api/stream/:id`, `/api/trailer/:id`                        | Video / trailer playback               |
| `GET /api/subtitles/:id`, `/api/poster/:id`, `/api/backdrop/:id` | Subtitles and artwork                  |
| `GET /api/progress`, `GET /api/progress?id=:id`                  | Continue watching / one saved position |
| `POST /api/progress`, `DELETE /api/progress/:id`                 | Save / remove progress                 |
| `GET /api/settings`, `POST /api/settings`                        | Read / save media folders              |
| `GET /api/metadata`, `PUT /api/metadata/:id`                     | Stored catalog / editable item fields  |
| `POST /api/view/:id`, `GET /api/status`                          | View count / server status             |

Media endpoints resolve indexed IDs and restrict file access to configured roots.
Browser cross-origin access is rejected. This is a personal, unauthenticated LAN
server: network clients can manage the library. Do not expose it to the internet.

## Development

Use Node 24+ to install and run development tools:

```sh
npm ci
npm test
npm run lint
npm run lint:fix
npm run format:check
npm run format
npm run knip
```

Tests use Node's built-in runner and disposable temporary directories. They cover
ranges, sparse large files, disconnects, scanner failures, metadata preservation,
JSON corruption/write failures, API validation, frontend behavior, and controlled
FFmpeg process success/failure. They never use your configured media folders.

ESLint checks backend CommonJS, browser scripts, and embedded HTML scripts with
separate global environments. The browser files document their shared classic
script names with `global` and `exported` comments. Knip includes browser entries
and tests; review findings before deleting code. Prettier ignores runtime data,
lockfiles, caches, and generated output. Formatting is kept separate from linting.

## Troubleshooting

- **`node` or `npm` not found:** install Node and reopen the terminal so its `bin`
  directory is on `PATH`. Development tooling needs Node 24+.
- **Empty library:** open Media Folders, verify the paths and read permissions,
  reconnect external drives, then rescan. Startup reuses an existing catalog.
- **TV cannot connect:** use the LAN URL, keep both devices on the same network,
  and check the host firewall. Guest Wi-Fi may isolate devices.
- **Video will not play:** try a browser-compatible MP4 codec combination. FFmpeg
  remuxing can help container/audio compatibility, but cannot fix an unsupported
  video codec without transcoding.
- **Data error:** stop the server and back up the named JSON file before repairing
  or restoring it. OrangeTV does not automatically reset damaged files.
- **Offline styling:** local streaming works without internet, but Tailwind loads
  from a CDN. First-load styling requires network access or a browser cache.
- **Address already in use:** choose another `PORT` or stop the other process.

MIT licensed.
