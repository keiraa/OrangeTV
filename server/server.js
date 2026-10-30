require('dotenv').config();
const path = require('path');
const fs = require('fs');
const express = require('express');
const cors = require('cors');

const { scanLibrary } = require('./scanner');
const { streamVideoDirect, streamVideoRemux, streamSubtitle, checkFfmpeg } = require('./streamer');
const { getContinueWatching, getItemProgress, updateProgress, deleteProgress } = require('./progress');
const { getPrimaryLocalIp, printStartupBanner } = require('./utils');

const PORT = parseInt(process.env.PORT || '3000', 10);
const DATA_DIR = path.join(__dirname, '../data');
const SETTINGS_FILE = path.join(DATA_DIR, 'settings.json');
const METADATA_FILE = path.join(DATA_DIR, 'metadata.json');

// Ensure data directory exists
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

// Load settings
function loadSettings() {
  let settings = {
    extraMediaPaths: process.env.EXTRA_MEDIA_PATHS
      ? process.env.EXTRA_MEDIA_PATHS.split(',').map(s => s.trim())
      : ['/Users/khasha/Desktop/Entertainment']
  };

  if (fs.existsSync(SETTINGS_FILE)) {
    try {
      const fileData = JSON.parse(fs.readFileSync(SETTINGS_FILE, 'utf8'));
      settings = { ...settings, ...fileData };
    } catch (e) {
      console.warn('[Server] Error reading settings.json:', e.message);
    }
  }
  return settings;
}

function saveSettings(settings) {
  try {
    fs.writeFileSync(SETTINGS_FILE, JSON.stringify(settings, null, 2), 'utf8');
  } catch (e) {
    console.error('[Server] Error saving settings.json:', e.message);
  }
}

// Persistent Metadata Store
function loadStoredMetadata() {
  if (fs.existsSync(METADATA_FILE)) {
    try {
      const data = JSON.parse(fs.readFileSync(METADATA_FILE, 'utf8'));
      if (data && (Array.isArray(data.movies) || Array.isArray(data.tvShows))) {
        return data;
      }
    } catch (e) {
      console.warn('[Server] Error reading metadata.json:', e.message);
    }
  }
  return null;
}

function saveStoredMetadata(catalog) {
  try {
    fs.writeFileSync(METADATA_FILE, JSON.stringify(catalog, null, 2), 'utf8');
    console.log('[Server] Saved library metadata to data/metadata.json');
  } catch (e) {
    console.error('[Server] Error saving metadata.json:', e.message);
  }
}

let appSettings = loadSettings();

// In-memory catalog
let cachedCatalog = { movies: [], tvShows: [], movieSeries: [], scannedAt: null };
// Lookup map for fast ID resolution: id -> item
const mediaItemMap = new Map();

function populateMediaItemMap(catalog) {
  mediaItemMap.clear();
  for (const movie of (catalog.movies || [])) {
    mediaItemMap.set(movie.id, movie);
  }
  for (const show of (catalog.tvShows || [])) {
    mediaItemMap.set(show.id, show);
    if (show.seasons && Array.isArray(show.seasons)) {
      for (const season of show.seasons) {
        if (season.episodes && Array.isArray(season.episodes)) {
          for (const ep of season.episodes) {
            mediaItemMap.set(ep.id, ep);
          }
        }
      }
    }
  }
  for (const series of (catalog.movieSeries || [])) {
    for (const m of (series.movies || [])) {
      if (!mediaItemMap.has(m.id)) {
        mediaItemMap.set(m.id, m);
      }
    }
  }
}

function getMediaRoots() {
  const roots = [];
  const defaultEntertainment = '/Users/khasha/Desktop/Entertainment';
  if (fs.existsSync(defaultEntertainment)) {
    roots.push(defaultEntertainment);
  }
  if (appSettings.extraMediaPaths && Array.isArray(appSettings.extraMediaPaths)) {
    for (const extra of appSettings.extraMediaPaths) {
      if (extra && fs.existsSync(extra) && !roots.includes(extra)) {
        roots.push(extra);
      }
    }
  }
  return roots;
}

async function refreshLibrary() {
  console.log('[Server] Scanning media directories...');
  const roots = getMediaRoots();
  const rawCatalog = scanLibrary(roots);

  // Load existing metadata to preserve artwork, series collections, overviews, and views
  const existingMetadata = loadStoredMetadata();
  const existingMap = new Map();
  const existingTitleMap = new Map();
  if (existingMetadata) {
    (existingMetadata.movies || []).forEach(m => {
      existingMap.set(m.id, m);
      if (m.title) existingTitleMap.set(m.title.toLowerCase().trim(), m);
    });
    (existingMetadata.tvShows || []).forEach(s => {
      existingMap.set(s.id, s);
      if (s.title) existingTitleMap.set(s.title.toLowerCase().trim(), s);
      (s.seasons || []).forEach(season => {
        (season.episodes || []).forEach(ep => existingMap.set(ep.id, ep));
      });
    });
    if (existingMetadata.movieSeries) {
      rawCatalog.movieSeries = existingMetadata.movieSeries;
    }
  }

  // Preserve stored metadata for movies
  for (const movie of rawCatalog.movies) {
    const existing = existingMap.get(movie.id) || existingTitleMap.get((movie.title || '').toLowerCase().trim());
    if (existing) {
      movie.title = existing.title || movie.title;
      movie.year = existing.year || movie.year;
      movie.genres = existing.genres || movie.genres || ['Movie'];
      movie.overview = existing.overview || null;
      movie.rating = existing.rating || null;
      movie.views = existing.views || 0;
      if (existing.series) movie.series = existing.series;
      if (existing.seriesOrder) movie.seriesOrder = existing.seriesOrder;
    } else {
      movie.genres = movie.genres || ['Movie'];
      movie.views = 0;
    }

    // Always ensure robust local endpoints for artwork
    movie.posterUrl = movie.localPoster ? `/api/poster/${movie.id}` : (movie.posterUrl || `/api/poster/${movie.id}`);
    movie.backdropUrl = movie.localBackdrop ? `/api/backdrop/${movie.id}` : (movie.backdropUrl || `/api/backdrop/${movie.id}`);
  }

  // Preserve stored metadata for TV shows & episodes
  for (const show of rawCatalog.tvShows) {
    const existing = existingMap.get(show.id) || existingTitleMap.get((show.title || '').toLowerCase().trim());
    if (existing) {
      show.title = existing.title || show.title;
      show.genres = existing.genres || ['TV Series'];
      show.overview = existing.overview || null;
      show.rating = existing.rating || null;
      show.views = existing.views || 0;
    } else {
      show.genres = show.genres || ['TV Series'];
      show.views = 0;
    }

    // Always ensure robust local endpoints for artwork
    show.posterUrl = show.localPoster ? `/api/poster/${show.id}` : (show.posterUrl || `/api/poster/${show.id}`);
    show.backdropUrl = show.localBackdrop ? `/api/backdrop/${show.id}` : (show.backdropUrl || `/api/backdrop/${show.id}`);

    for (const season of show.seasons) {
      for (const ep of season.episodes) {
        ep.posterUrl = show.posterUrl;
        ep.backdropUrl = show.backdropUrl;
      }
    }
  }

  rawCatalog.scannedAt = Date.now();
  cachedCatalog = rawCatalog;
  populateMediaItemMap(cachedCatalog);

  // Persist to disk
  saveStoredMetadata(cachedCatalog);
  console.log(`[Server] Indexed and saved ${rawCatalog.movies.length} movies and ${rawCatalog.tvShows.length} TV shows to data/metadata.json.`);
}

const app = express();
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, '../public')));
app.use('/images', express.static(path.join(__dirname, '../data/images')));

/**
 * GET /api/library - Returns full catalog & continue watching row
 */
app.get('/api/library', (req, res) => {
  const continueWatching = getContinueWatching(20)
    .filter(item => mediaItemMap.has(item.id))
    .map(item => {
      const media = mediaItemMap.get(item.id);
      return {
        ...item,
        title: media?.title || item.title,
        showTitle: media?.showTitle || item.showTitle,
        posterUrl: media?.posterUrl || `/api/poster/${item.id}`,
        backdropUrl: media?.backdropUrl || `/api/backdrop/${item.id}`,
        views: media?.views || 0,
        rating: media?.rating || null,
        genres: media?.genres || [],
        trailerPath: media?.trailerPath || null,
        season: media?.season || item.season,
        episode: media?.episode || item.episode
      };
    });

  res.json({
    movies: cachedCatalog.movies || [],
    tvShows: cachedCatalog.tvShows || [],
    movieSeries: cachedCatalog.movieSeries || [],
    continueWatching,
    scannedAt: cachedCatalog.scannedAt
  });
});

/**
 * GET /api/backdrop/:id - Serve local backdrop image or fallback to poster
 */
app.get('/api/backdrop/:id', (req, res) => {
  const item = mediaItemMap.get(req.params.id);
  if (item && item.localBackdrop && fs.existsSync(item.localBackdrop)) {
    return res.sendFile(path.resolve(item.localBackdrop));
  }
  if (item && item.localPoster && fs.existsSync(item.localPoster)) {
    return res.sendFile(path.resolve(item.localPoster));
  }
  // Check in data/images/backdrops
  const fallback = path.join(DATA_DIR, 'images/backdrops', `${req.params.id}.jpg`);
  if (fs.existsSync(fallback)) {
    return res.sendFile(fallback);
  }
  return res.status(404).send('Backdrop not found');
});

/**
 * POST /api/view/:id - Increment view count for a media item
 */
app.post('/api/view/:id', (req, res) => {
  const item = mediaItemMap.get(req.params.id);
  if (!item) {
    return res.status(404).json({ error: 'Media not found' });
  }

  item.views = (item.views || 0) + 1;
  saveStoredMetadata(cachedCatalog);
  res.json({ success: true, views: item.views });
});

/**
 * POST /api/library/rescan - Trigger manual rescan
 */
app.post('/api/library/rescan', async (req, res) => {
  await refreshLibrary();
  res.json({ success: true, count: mediaItemMap.size });
});

/**
 * GET /api/stream/:id - Stream video (supports Range requests & remuxing)
 */
app.get('/api/stream/:id', (req, res) => {
  const item = mediaItemMap.get(req.params.id);
  if (!item || !item.filePath) {
    return res.status(404).json({ error: 'Media not found' });
  }

  const shouldRemux = req.query.remux === 'true';
  const startTime = parseFloat(req.query.t || '0');

  if (shouldRemux) {
    return streamVideoRemux(req, res, item.filePath, startTime);
  }

  return streamVideoDirect(req, res, item.filePath);
});

/**
 * GET /api/trailer/:id - Stream movie short trailer
 */
app.get('/api/trailer/:id', (req, res) => {
  const item = mediaItemMap.get(req.params.id);
  if (!item || !item.trailerPath || !fs.existsSync(item.trailerPath)) {
    return res.status(404).json({ error: 'Trailer not found' });
  }
  return streamVideoDirect(req, res, item.trailerPath);
});

/**
 * GET /api/subtitles/:id - Serve subtitle as WebVTT
 */
app.get('/api/subtitles/:id', (req, res) => {
  let subtitlePath = null;

  for (const item of mediaItemMap.values()) {
    if (item.subtitles && Array.isArray(item.subtitles)) {
      const match = item.subtitles.find(s => s.id === req.params.id);
      if (match) {
        subtitlePath = match.path;
        break;
      }
    }
  }

  if (!subtitlePath) {
    return res.status(404).send('Subtitle not found');
  }

  streamSubtitle(req, res, subtitlePath);
});

/**
 * GET /api/poster/:id - Serve local poster image or generate stylish SVG fallback
 */
app.get('/api/poster/:id', (req, res) => {
  const item = mediaItemMap.get(req.params.id);
  if (item && item.localPoster && fs.existsSync(item.localPoster)) {
    return res.sendFile(path.resolve(item.localPoster));
  }

  // Generate dynamic SVG poster with Orange TV aesthetic
  const title = item ? (item.title || item.showTitle || 'Movie') : 'Local Media';
  const year = item && item.year ? item.year : '';
  const type = item && item.type === 'tv' ? 'TV SERIES' : 'MOVIE';

  const svg = `
    <svg xmlns="http://www.w3.org/2000/svg" width="300" height="450" viewBox="0 0 300 450">
      <defs>
        <linearGradient id="bg" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stop-color="#1c1a17"/>
          <stop offset="50%" stop-color="#121110"/>
          <stop offset="100%" stop-color="#080807"/>
        </linearGradient>
        <linearGradient id="accent" x1="0%" y1="0%" x2="100%" y2="0%">
          <stop offset="0%" stop-color="#FF7A00"/>
          <stop offset="100%" stop-color="#FF9500"/>
        </linearGradient>
      </defs>
      <rect width="300" height="450" rx="8" fill="url(#bg)"/>
      <rect x="0" y="444" width="300" height="6" fill="url(#accent)"/>
      
      <!-- Film reel icon -->
      <g transform="translate(110, 140)" fill="#333" stroke="#444" stroke-width="2">
        <circle cx="40" cy="40" r="36" fill="#1e1a16"/>
        <circle cx="40" cy="40" r="12" fill="#FF7A00"/>
        <circle cx="40" cy="18" r="6" fill="#141414"/>
        <circle cx="40" cy="62" r="6" fill="#141414"/>
        <circle cx="18" cy="40" r="6" fill="#141414"/>
        <circle cx="62" cy="40" r="6" fill="#141414"/>
      </g>

      <text x="150" y="250" font-family="-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif" font-size="11" font-weight="bold" fill="#FF8C00" letter-spacing="2" text-anchor="middle">${type}</text>
      <text x="150" y="280" font-family="-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif" font-size="18" font-weight="bold" fill="#FFFFFF" text-anchor="middle">
        ${escapeXml(title.length > 24 ? title.substring(0, 22) + '...' : title)}
      </text>
      ${year ? `<text x="150" y="306" font-family="-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif" font-size="13" fill="#888888" text-anchor="middle">${year}</text>` : ''}
    </svg>
  `.trim();

  res.setHeader('Content-Type', 'image/svg+xml');
  res.setHeader('Cache-Control', 'public, max-age=86400');
  res.send(svg);
});

function escapeXml(unsafe) {
  return unsafe.replace(/[<>&'"]/g, c => {
    switch (c) {
      case '<': return '&lt;';
      case '>': return '&gt;';
      case '&': return '&amp;';
      case '\'': return '&apos;';
      case '"': return '&quot;';
    }
  });
}

/**
 * GET /api/progress - Get continue watching list
 */
app.get('/api/progress', (req, res) => {
  res.json(getContinueWatching());
});

/**
 * POST /api/progress - Save watch progress timestamp
 */
app.post('/api/progress', (req, res) => {
  const result = updateProgress(req.body);
  res.json({ success: !!result, data: result });
});

/**
 * DELETE /api/progress/:id - Delete item progress
 */
app.delete('/api/progress/:id', (req, res) => {
  const success = deleteProgress(req.params.id);
  res.json({ success });
});

/**
 * GET /api/settings - Fetch current server settings
 */
app.get('/api/settings', (req, res) => {
  res.json({
    extraMediaPaths: appSettings.extraMediaPaths || [],
    mediaRoots: getMediaRoots()
  });
});

/**
 * POST /api/settings - Update settings (Extra Media Paths)
 */
app.post('/api/settings', async (req, res) => {
  if (Array.isArray(req.body.extraMediaPaths)) {
    appSettings.extraMediaPaths = req.body.extraMediaPaths.map(s => s.trim()).filter(Boolean);
  }
  saveSettings(appSettings);
  await refreshLibrary();
  res.json({ success: true, settings: appSettings });
});

/**
 * GET /api/metadata - Get full stored metadata catalog
 */
app.get('/api/metadata', (req, res) => {
  const stored = loadStoredMetadata();
  res.json(stored || cachedCatalog);
});

/**
 * PUT /api/metadata/:id - Update metadata for a specific media item
 */
app.put('/api/metadata/:id', (req, res) => {
  const item = mediaItemMap.get(req.params.id);
  if (!item) {
    return res.status(404).json({ error: 'Item not found' });
  }

  const { title, year, overview, rating, genres, posterUrl, backdropUrl } = req.body;
  if (title !== undefined) item.title = title.trim();
  if (year !== undefined) item.year = year ? parseInt(year, 10) : null;
  if (overview !== undefined) item.overview = overview;
  if (rating !== undefined) item.rating = rating;
  if (Array.isArray(genres)) item.genres = genres;
  if (posterUrl !== undefined) item.posterUrl = posterUrl;
  if (backdropUrl !== undefined) item.backdropUrl = backdropUrl;

  saveStoredMetadata(cachedCatalog);
  res.json({ success: true, item });
});

/**
 * GET /api/status - Server health, network IPs, ffmpeg status
 */
app.get('/api/status', async (req, res) => {
  const hasFfmpeg = await checkFfmpeg();
  res.json({
    status: 'online',
    port: PORT,
    localIp: getPrimaryLocalIp(),
    ffmpegAvailable: hasFfmpeg,
    moviesCount: cachedCatalog.movies.length,
    tvShowsCount: cachedCatalog.tvShows.length
  });
});

// Start Server
app.listen(PORT, '0.0.0.0', async () => {
  const localIp = getPrimaryLocalIp();
  printStartupBanner(PORT, localIp);

  const stored = loadStoredMetadata();
  if (stored && (stored.movies?.length > 0 || stored.tvShows?.length > 0)) {
    cachedCatalog = stored;
    populateMediaItemMap(cachedCatalog);
    console.log(`[Server] Loaded ${cachedCatalog.movies.length} movies and ${cachedCatalog.tvShows.length} TV shows from data/metadata.json.`);
  } else {
    await refreshLibrary();
  }
});
