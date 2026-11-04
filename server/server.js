require('dotenv').config();
const path = require('path');
const fs = require('fs');
const os = require('os');
const express = require('express');
const cors = require('cors');
const { Catalog } = require('./catalog');
const { readJson, writeJson } = require('./json-store');
const {
  streamVideoDirect,
  streamVideoRemux,
  streamSubtitle,
  checkFfmpeg,
} = require('./streamer');
const {
  getContinueWatching,
  getItemProgress,
  updateProgress,
  deleteProgress,
} = require('./progress');
const { getPrimaryLocalIp, printStartupBanner } = require('./utils');

function validSettings(value) {
  return (
    value !== null &&
    typeof value === 'object' &&
    !Array.isArray(value) &&
    Array.isArray(value.extraMediaPaths) &&
    value.extraMediaPaths.every((entry) => typeof entry === 'string')
  );
}

function mediaRoots(paths) {
  return [
    ...new Set(
      paths
        .map((entry) => entry.trim())
        .filter(Boolean)
        .map((trimmed) => {
          return trimmed === '~'
            ? os.homedir()
            : path.resolve(
                trimmed.startsWith('~/')
                  ? path.join(os.homedir(), trimmed.slice(2))
                  : trimmed
              );
        })
    ),
  ];
}

function metadataChanges(body) {
  const changes = {};
  if (body.title !== undefined) {
    if (typeof body.title !== 'string' || !body.title.trim()) return null;
    changes.title = body.title.trim();
  }
  if (body.year !== undefined) {
    if (body.year !== null && !['string', 'number'].includes(typeof body.year))
      return null;
    const year =
      body.year === null || body.year === '' ? null : Number(body.year);
    if (year !== null && (!Number.isInteger(year) || year < 0 || year > 9999))
      return null;
    changes.year = year;
  }
  if (body.overview !== undefined) {
    if (body.overview !== null && typeof body.overview !== 'string')
      return null;
    changes.overview = body.overview;
  }
  if (body.rating !== undefined) {
    if (
      body.rating !== null &&
      !['string', 'number'].includes(typeof body.rating)
    )
      return null;
    const rating =
      body.rating === null || body.rating === '' ? null : Number(body.rating);
    if (
      rating !== null &&
      (!Number.isFinite(rating) || rating < 0 || rating > 10)
    )
      return null;
    changes.rating = rating;
  }
  if (body.genres !== undefined) {
    if (
      !Array.isArray(body.genres) ||
      !body.genres.every((genre) => typeof genre === 'string')
    )
      return null;
    changes.genres = body.genres;
  }
  for (const key of ['posterUrl', 'backdropUrl']) {
    if (body[key] === undefined) continue;
    if (body[key] !== null && typeof body[key] !== 'string') return null;
    if (body[key]) {
      try {
        if (
          !['http:', 'https:'].includes(
            new URL(body[key], 'http://localhost').protocol
          )
        )
          return null;
      } catch {
        return null;
      }
    }
    changes[key] = body[key];
  }
  return changes;
}

function createApp({
  dataDir = path.join(__dirname, '../data'),
  mediaPaths,
} = {}) {
  const settingsFile = path.join(dataDir, 'settings.json');
  const progressFile = path.join(dataDir, 'progress.json');
  const defaults = {
    extraMediaPaths:
      mediaPaths ??
      (process.env.EXTRA_MEDIA_PATHS || '')
        .split(',')
        .map((value) => value.trim())
        .filter(Boolean),
  };
  let settings = readJson(settingsFile, defaults, validSettings);
  if (!validSettings(settings))
    throw new Error('Invalid media path configuration');
  const catalog = new Catalog(
    path.join(dataDir, 'metadata.json'),
    mediaRoots(settings.extraMediaPaths)
  );
  const app = express();

  app.use((req, res, next) => {
    const origin = req.get('origin');
    if (origin && origin !== `${req.protocol}://${req.get('host')}`) {
      return res
        .status(403)
        .json({ error: 'Cross-origin access is not allowed' });
    }
    next();
  });
  app.use(cors({ origin: true }));
  app.use(express.json({ limit: '100kb' }));
  app.use(express.static(path.join(__dirname, '../public')));
  app.use(
    '/images',
    express.static(path.join(dataDir, 'images'), { dotfiles: 'deny' })
  );
  app.param('id', (req, res, next, id) => {
    if (!/^[\w-]{1,128}$/.test(id))
      return res.status(400).json({ error: 'Invalid media ID' });
    next();
  });

  app.get('/api/library', (_req, res) => {
    const continueWatching = getContinueWatching(
      Number.MAX_SAFE_INTEGER,
      progressFile
    )
      .filter((item) => catalog.items.has(item.id))
      .slice(0, 20)
      .map((item) => {
        const media = catalog.items.get(item.id);
        return { ...item, ...media };
      });
    res.json({ ...catalog.active, continueWatching });
  });

  app.get('/api/backdrop/:id', (req, res) => {
    const item = catalog.items.get(req.params.id);
    const file =
      catalog.resolveFile(item?.localBackdrop) ||
      catalog.resolveFile(item?.localPoster);
    if (file) return res.sendFile(file);
    const fallback = path.join(
      dataDir,
      'images/backdrops',
      `${req.params.id}.jpg`
    );
    if (fs.existsSync(fallback)) return res.sendFile(path.resolve(fallback));
    res.redirect(`/api/poster/${req.params.id}`);
  });

  app.get('/api/poster/:id', (req, res) => {
    const item = catalog.items.get(req.params.id);
    const file = catalog.resolveFile(item?.localPoster);
    if (file) return res.sendFile(file);
    res
      .type('svg')
      .set('Cache-Control', 'public, max-age=86400')
      .send(posterSvg(item));
  });

  app.post('/api/view/:id', (req, res) => {
    const item = catalog.items.get(req.params.id);
    if (!item) return res.status(404).json({ error: 'Media not found' });
    const updated = catalog.update(item.id, { views: (item.views || 0) + 1 });
    res.json({ success: true, views: updated.views });
  });

  app.post('/api/library/rescan', (_req, res) => {
    catalog.refresh();
    res.json({ success: true, count: catalog.items.size });
  });

  app.get('/api/stream/:id', (req, res, next) => {
    const file = catalog.resolveFile(
      catalog.items.get(req.params.id)?.filePath
    );
    if (!file)
      return res.status(404).json({ error: 'Media not found or unavailable' });
    if (req.query.remux === 'true') {
      return streamVideoRemux(req, res, file, Number(req.query.t ?? 0)).catch(
        next
      );
    }
    return streamVideoDirect(req, res, file);
  });

  app.get('/api/trailer/:id', (req, res) => {
    const file = catalog.resolveFile(
      catalog.items.get(req.params.id)?.trailerPath
    );
    if (!file) return res.status(404).json({ error: 'Trailer not found' });
    streamVideoDirect(req, res, file);
  });

  app.get('/api/subtitles/:id', (req, res) => {
    const file = catalog.resolveFile(catalog.subtitles.get(req.params.id));
    if (!file) return res.status(404).json({ error: 'Subtitle not found' });
    streamSubtitle(req, res, file);
  });

  app.get('/api/progress', (req, res) => {
    if (req.query.id !== undefined) {
      if (
        typeof req.query.id !== 'string' ||
        !catalog.items.has(req.query.id)
      ) {
        return res.status(404).json({ error: 'Media not found' });
      }
      return res.json(getItemProgress(req.query.id, progressFile));
    }
    res.json(getContinueWatching(20, progressFile));
  });

  app.post('/api/progress', (req, res) => {
    const item = catalog.items.get(req.body?.id);
    if (!item) return res.status(404).json({ error: 'Media not found' });
    const result = updateProgress(
      {
        ...item,
        currentTime: req.body.currentTime,
        duration: req.body.duration,
      },
      progressFile
    );
    if (!result) return res.status(400).json({ error: 'Invalid progress' });
    res.json({ success: true, data: result });
  });

  app.delete('/api/progress/:id', (req, res) => {
    res.json({ success: deleteProgress(req.params.id, progressFile) });
  });

  app.get('/api/settings', (_req, res) => {
    res.json({
      ...settings,
      mediaRoots: mediaRoots(settings.extraMediaPaths).filter((root) =>
        fs.existsSync(root)
      ),
    });
  });

  app.post('/api/settings', (req, res) => {
    if (!validSettings(req.body))
      return res
        .status(400)
        .json({ error: 'extraMediaPaths must be an array of strings' });
    const nextSettings = {
      ...settings,
      extraMediaPaths: req.body.extraMediaPaths
        .map((value) => value.trim())
        .filter(Boolean),
    };
    writeJson(settingsFile, nextSettings, validSettings);
    settings = nextSettings;
    catalog.refresh(mediaRoots(settings.extraMediaPaths));
    res.json({ success: true, settings });
  });

  app.get('/api/metadata', (_req, res) => res.json(catalog.stored));

  app.put('/api/metadata/:id', (req, res) => {
    if (!catalog.items.has(req.params.id))
      return res.status(404).json({ error: 'Item not found' });
    if (!req.body || typeof req.body !== 'object' || Array.isArray(req.body)) {
      return res.status(400).json({ error: 'Invalid metadata' });
    }
    const changes = metadataChanges(req.body);
    if (!changes) return res.status(400).json({ error: 'Invalid metadata' });
    const item = catalog.update(req.params.id, changes);
    res.json({ success: true, item });
  });

  app.get('/api/status', async (req, res, next) => {
    try {
      res.json({
        status: 'online',
        port: req.socket.localPort,
        localIp: getPrimaryLocalIp(),
        ffmpegAvailable: await checkFfmpeg(),
        moviesCount: catalog.active.movies.length,
        tvShowsCount: catalog.active.tvShows.length,
      });
    } catch (err) {
      next(err);
    }
  });

  app.use('/api', (_req, res) =>
    res.status(404).json({ error: 'Endpoint not found' })
  );
  app.use((err, _req, res, _next) => {
    console.error('[Server]', err.message);
    if (res.headersSent) return res.destroy();
    const status =
      Number.isInteger(err.status) && err.status >= 400 && err.status < 600
        ? err.status
        : 500;
    res.status(status).json({
      error:
        status < 500 ? err.message : 'Operation failed; check the server log',
    });
  });
  return app;
}

function escapeXml(value) {
  const entities = {
    '<': '&lt;',
    '>': '&gt;',
    '&': '&amp;',
    "'": '&apos;',
    '"': '&quot;',
  };
  return String(value).replace(/[<>&'"]/g, (character) => entities[character]);
}

function posterSvg(item) {
  const title = item?.title || item?.showTitle || 'Local Media';
  const year = item?.year || '';
  const type = item?.type === 'tv' ? 'TV SERIES' : 'MOVIE';
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
      ${year ? `<text x="150" y="306" font-family="-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif" font-size="13" fill="#888888" text-anchor="middle">${escapeXml(String(year))}</text>` : ''}
    </svg>
  `.trim();

  return svg;
}

if (require.main === module) {
  try {
    const port = Number(process.env.PORT ?? 3000);
    if (!Number.isInteger(port) || port < 0 || port > 65535)
      throw new Error('PORT must be an integer from 0 to 65535');
    const app = createApp();
    const server = app.listen(port, '0.0.0.0', () => {
      printStartupBanner(server.address().port, getPrimaryLocalIp());
    });
    server.on('error', (err) => {
      console.error('[Server] Unable to start:', err.message);
      process.exitCode = 1;
    });
  } catch (err) {
    console.error('[Server] Unable to start:', err.message);
    process.exitCode = 1;
  }
}

module.exports = { createApp };
