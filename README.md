# 🍊 Orange TV — Personal Home Media Center

An ultra-lightweight, zero-transcode local streaming server built for macOS and Smart TVs. Host your local movie and TV show collection and stream directly to Smart TV web browsers, tablets, phones, and laptops across your home network with zero unnecessary CPU load.

Designed with an **Apple TV-inspired glassmorphism interface**, spatial D-pad remote navigation, instant resume tracking, and automated franchise collections.

---

## ⚡ Highlights

- **Direct Play Streaming (0% CPU Transcoding)**: Streams MP4, MKV, WebM, and M4V video files directly using HTTP 206 Partial Content (Range requests) with instant forward/backward seeking. Your Mac stays completely cool and silent without loud fans spinning.
- **Smart TV Remote (D-Pad) Spatial Navigation**: Engineered from the ground up for physical Smart TV remotes (LG webOS, Samsung Tizen, Android TV, Fire TV, Google TV) with full directional focus rings, Enter/OK selection, and Back navigation.
- **Apple TV & Glassmorphic UI**:
  - SF Pro typography, frosted glass panels, and signature orange glowing accents
  - 3D interactive tilt & light-glare physics on media cards
  - Dynamic cinematic hero banner with backdrop art, ratings, and synopsis
  - Automatic franchise & collection clustering (Harry Potter, Marvel, Avatar, etc.)
  - Deep-dive TV show drawer with season & episode picker
- **Intelligent Playback Tracking**:
  - Remembers exact playback timestamps per video
  - One-click resume prompt (*"Resume from 42:15"* or *"Start from Beginning"*)
  - Automatic *Continue Watching* carousel with live orange progress bars
  - Finished items (>92%) automatically clear from the queue
- **On-the-Fly Subtitles**: Automatically detects local `.srt` and `.vtt` subtitles, converting SRT to WebVTT on-the-fly for native browser display.
- **Mac Sleep Prevention (`caffeinate`)**: Built-in Mac caffeinate mode prevents your Mac from going to sleep during playback without touching system power settings.
- **Instant TV Pairing**: Automatically discovers your local LAN IP and renders an ASCII QR code directly in the terminal for 2-second pairing with phones or TVs.
- **Flexible Media Folders (Zero File Copying)**: Map external hard drives, USB enclosures, or custom Mac folders (`~/Movies`, `/Volumes/DriveName`) via in-app Settings without copying multi-gigabyte files.
- **Full Offline Support**: Works seamlessly without internet connectivity using smart filename parsing and dynamic SVG poster generation.

---

## 🎯 Primary Use Cases

### 1. Living Room Movie Night on Smart TV
Stream your 1080p and 4K video files stored on your Mac directly to your living room TV (LG webOS, Samsung Tizen, Sony Google TV, Fire TV, Apple TV):
1. Launch Orange TV on your Mac (`npm run start:caffeinate`).
2. Open the built-in web browser on your TV.
3. Type the LAN IP or scan the terminal QR code using your phone/TV camera.
4. Sit back on your couch and navigate effortlessly using only your TV remote's arrow keys and OK button.

### 2. Multi-Room Streaming (Phone, iPad, Laptop)
Watch your movies anywhere in your home:
- Open Safari or Chrome on your iPhone, iPad, Android device, or secondary laptop.
- The UI dynamically scales with smooth touch controls, responsive video playback, and swipe-friendly navigation.

### 3. External Hard Drive & NAS Vault
Have a 2TB or 4TB external hard drive filled with movies and shows?
- Keep your media on the external drive.
- Add `/Volumes/MyHardDrive/Movies` to Orange TV's settings.
- Orange TV indexes and catalogs everything instantly without moving or duplicating a single byte.

### 4. Road Trips & Offline Cabin Playback
Traveling with no Wi-Fi or internet connection?
- Connect your Mac and devices to a portable Wi-Fi hotspot or travel router (no internet required).
- Orange TV serves media offline with embedded poster fallbacks and smart filename parsing.

---

## 🚀 Quick Start

### 1. Requirements
- macOS (Intel or Apple Silicon) or Linux/Windows
- [Node.js](https://nodejs.org/) v18+ and `npm`

### 2. Install Dependencies
```bash
# Clone the repository
git clone https://github.com/<your-username>/orange-tv.git
cd orange-tv

# Install packages
npm install
```

### 3. Start the Server

#### Option A: Keep-Awake Mode (Recommended for macOS)
Prevents your Mac from sleeping or dimming the screen during playback:
```bash
npm run start:caffeinate
```

#### Option B: Standard Mode
```bash
npm start
```

Upon launching, the terminal will display your local address, LAN address, and a scannable ASCII QR code:

```text
======================================================
              🍊 ORANGE TV MEDIA SERVER 🍊            
======================================================

  Local Host:      http://localhost:3000
  Smart TV URL:    http://192.168.1.105:3000

------------------------------------------------------
  Open the Smart TV URL on your TV web browser!
  Or scan this QR code with your phone/TV camera:

  ▄▄▄▄▄▄▄ ▄ ▄▄ ▄▄▄▄▄▄▄
  █ ▄▄▄ █ ▄ █▄ █ ▄▄▄ █
  ...
------------------------------------------------------
```

---

## 📺 How to Watch on Your Smart TV

1. **Ensure Wi-Fi Connection**: Verify your Smart TV and your Mac are connected to the same home Wi-Fi network.
2. **Open TV Browser**: Open the built-in web browser on your TV (e.g. *Web Browser* on LG webOS, *Internet* on Samsung Tizen, or *Silk Browser* on Fire TV).
3. **Navigate to the URL**: Enter the `Smart TV URL` printed in your terminal (e.g., `http://192.168.1.105:3000`).
4. **Bookmark for Instant Access**: Add the page to your TV browser bookmarks or speed-dial for 1-click access next time.

### TV Remote & Keyboard Controls

| Action | Smart TV Remote | Keyboard | Mouse / Touch |
|---|---|---|---|
| **Navigate Grid & Carousels** | D-Pad Arrows (▲ ▼ ◄ ►) | `ArrowUp`, `ArrowDown`, `ArrowLeft`, `ArrowRight` | Hover / Click |
| **Select / Open / Play** | `OK` / `Enter` | `Enter` | Click / Tap |
| **Back / Close Modal** | `Back` / `Return` | `Escape` / `Backspace` | Close Button |
| **Play / Pause** | `Play` / `Pause` / `OK` | `Space` / `Enter` | Tap Video |
| **Seek Forward (+10s)** | Right Arrow (►) | `ArrowRight` | Scrub Bar |
| **Seek Backward (-10s)** | Left Arrow (◄) | `ArrowLeft` | Scrub Bar |
| **Volume Control** | TV Volume Buttons | `ArrowUp` / `ArrowDown` | Volume Slider |
| **Toggle Fullscreen** | Fullscreen Button | `f` / `F` | Fullscreen Icon |

---

## 📂 Media Organization

Orange TV automatically parses titles, release years, series collections, and TV show seasons/episodes from your directory structure and filenames.

### Movies
Organize movies in dedicated folders or flat files:
```text
Movies/
├── Interstellar (2014)/
│   ├── Interstellar (2014).mp4
│   ├── Interstellar (2014).en.srt    # (Optional subtitle)
│   └── poster.jpg                    # (Optional custom poster)
├── Inception (2010).mp4
└── Dune Part Two (2024).mkv
```

### TV Shows
Organize series with Season folders and standard SxxExx episode notation:
```text
TV Shows/
└── Breaking Bad/
    ├── poster.jpg                    # (Optional show poster)
    ├── backdrop.jpg                  # (Optional show backdrop)
    ├── Season 1/
    │   ├── Breaking.Bad.S01E01.mp4
    │   ├── Breaking.Bad.S01E01.en.srt
    │   └── Breaking.Bad.S01E02.mp4
    └── Season 2/
        ├── Breaking.Bad.S02E01.mp4
        └── Breaking.Bad.S02E02.mp4
```

### Movie Collections & Series
Orange TV automatically identifies and clusters related films (e.g., *Avatar*, *Harry Potter*, *John Wick*, *Deadpool*, *Lord of the Rings*) into a dedicated **Series & Franchises** carousel on the home screen.

### Supported File Formats
- **Video**: `.mp4`, `.mkv`, `.webm`, `.m4v`, `.mov`, `.avi`
- **Subtitles**: `.srt` (converted on-the-fly), `.vtt`
- **Artwork**: `.jpg`, `.jpeg`, `.png`, `.webp` (or auto-generated vector posters)

---

## ⚙️ Configuration & Adding Folders

### 1. In-App Settings (Easiest)
Click the **Settings (gear icon)** in the top navigation bar of Orange TV:
- Enter paths to external hard drives or local folders (e.g. `/Volumes/MediaDrive/Movies` or `/Users/username/Movies`).
- Click **Add Path** and **Rescan Library**.

### 2. Environment Variables (`.env`)
Create an optional `.env` file in the root directory:
```bash
PORT=3000
EXTRA_MEDIA_PATHS="/Volumes/Storage/Movies,/Users/username/Desktop/Entertainment"
```

---

## 💾 Where Data is Stored

Orange TV keeps runtime states separate from code in the [`data/`](file:///Users/khasha/Desktop/Projects/Local%20Netflix/data) directory (which is safely excluded from Git):

- `data/metadata.json`: Parsed media catalog (movies, TV shows, seasons, series collections, and file paths).
- `data/progress.json`: Playback resume timestamps and watch history.
- `data/settings.json`: Configured extra folder paths.
- `data/images/`: Cached posters and backdrops.

---

## 🛠️ Tech Stack & Architecture

- **Backend**: Node.js & Express.
  - Zero heavy background transcoding or multi-thread CPU consumption.
  - Direct byte-range streaming via HTTP 206 Partial Content.
  - On-the-fly WebVTT subtitle stream converter.
- **Frontend**: Vanilla ES6+ & Tailwind CSS.
  - Apple Glassmorphic design system (`backdrop-filter: blur()`).
  - Spatial Navigation Engine for TV D-Pad remote control.
  - Hardware-accelerated CSS 3D transforms for card tilt and glare effects.

---

## 📄 License

MIT License. Free and open source for personal use.
