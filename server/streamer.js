const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const { srtToVtt } = require('./utils');

const MIME_MAP = {
  '.mp4': 'video/mp4',
  '.m4v': 'video/mp4',
  '.webm': 'video/webm',
  '.mkv': 'video/x-matroska',
  '.mov': 'video/quicktime',
  '.avi': 'video/x-msvideo',
  '.vtt': 'text/vtt',
  '.srt': 'text/vtt' // will be converted
};

// Check if ffmpeg binary exists
let ffmpegAvailable = null;
function checkFfmpeg() {
  if (ffmpegAvailable !== null) return Promise.resolve(ffmpegAvailable);
  return new Promise(resolve => {
    const proc = spawn('ffmpeg', ['-version']);
    proc.on('error', () => {
      ffmpegAvailable = false;
      resolve(false);
    });
    proc.on('close', code => {
      ffmpegAvailable = (code === 0);
      resolve(ffmpegAvailable);
    });
  });
}

/**
 * Handle HTTP 206 Partial Content (Range requests) for fast zero-CPU direct streaming.
 */
function streamVideoDirect(req, res, filePath) {
  if (!fs.existsSync(filePath)) {
    return res.status(404).json({ error: 'File not found' });
  }

  const stat = fs.statSync(filePath);
  const fileSize = stat.size;
  const ext = path.extname(filePath).toLowerCase();
  const mimeType = MIME_MAP[ext] || 'video/mp4';

  const range = req.headers.range;

  if (range) {
    // Parse Range header: "bytes=start-end"
    const parts = range.replace(/bytes=/, '').split('-');
    const start = parseInt(parts[0], 10);
    // Standard chunk size: 3MB max chunk if end is omitted to prevent buffer saturation
    const defaultChunk = 3 * 1024 * 1024;
    const end = parts[1] ? parseInt(parts[1], 10) : Math.min(start + defaultChunk, fileSize - 1);

    if (start >= fileSize) {
      res.status(416).setHeader('Content-Range', `bytes */${fileSize}`);
      return res.end();
    }

    const chunksize = (end - start) + 1;
    const stream = fs.createReadStream(filePath, { start, end });

    res.writeHead(206, {
      'Content-Range': `bytes ${start}-${end}/${fileSize}`,
      'Accept-Ranges': 'bytes',
      'Content-Length': chunksize,
      'Content-Type': mimeType,
      'Cache-Control': 'no-cache, no-store, must-revalidate'
    });

    // Cleanup stream if client disconnects or seeks
    req.on('close', () => {
      stream.destroy();
    });

    stream.pipe(res);
  } else {
    // Full file stream
    res.writeHead(200, {
      'Content-Length': fileSize,
      'Accept-Ranges': 'bytes',
      'Content-Type': mimeType,
      'Cache-Control': 'no-cache, no-store, must-revalidate'
    });

    const stream = fs.createReadStream(filePath);
    req.on('close', () => {
      stream.destroy();
    });

    stream.pipe(res);
  }
}

/**
 * Stream video with on-the-fly FFmpeg container/audio remuxing (stream-copy, no heavy video encoding).
 */
async function streamVideoRemux(req, res, filePath, startTimeSeconds = 0) {
  const hasFfmpeg = await checkFfmpeg();
  if (!hasFfmpeg) {
    console.warn('[Streamer] FFmpeg not found on system; falling back to direct play');
    return streamVideoDirect(req, res, filePath);
  }

  res.writeHead(200, {
    'Content-Type': 'video/mp4',
    'Accept-Ranges': 'none',
    'Cache-Control': 'no-cache'
  });

  const args = [
    '-ss', String(startTimeSeconds),
    '-i', filePath,
    '-c:v', 'copy',                // Zero CPU video frame copy!
    '-c:a', 'aac',                 // Fast AAC audio encoding for 100% TV compatibility
    '-b:a', '192k',
    '-f', 'mp4',
    '-movflags', 'frag_keyframe+empty_moov+default_base_moof',
    'pipe:1'
  ];

  const ffmpegProc = spawn('ffmpeg', args);

  req.on('close', () => {
    ffmpegProc.kill('SIGKILL');
  });

  ffmpegProc.stdout.pipe(res);

  ffmpegProc.stderr.on('data', () => {
    // suppress verbose output
  });

  ffmpegProc.on('error', (err) => {
    console.error('[Streamer] FFmpeg spawn error:', err.message);
    if (!res.headersSent) {
      res.status(500).json({ error: 'FFmpeg remux failed' });
    }
  });
}

/**
 * Serve subtitle file in standard WebVTT format (converts SRT on-the-fly).
 */
function streamSubtitle(req, res, subtitlePath) {
  if (!fs.existsSync(subtitlePath)) {
    return res.status(404).send('Subtitle file not found');
  }

  const ext = path.extname(subtitlePath).toLowerCase();

  res.setHeader('Content-Type', 'text/vtt; charset=utf-8');
  res.setHeader('Cache-Control', 'public, max-age=86400');

  if (ext === '.vtt') {
    fs.createReadStream(subtitlePath).pipe(res);
  } else if (ext === '.srt') {
    fs.readFile(subtitlePath, 'utf8', (err, data) => {
      if (err) return res.status(500).send('Error reading subtitle');
      const vtt = srtToVtt(data);
      res.send(vtt);
    });
  } else {
    res.status(400).send('Unsupported subtitle format');
  }
}

module.exports = {
  streamVideoDirect,
  streamVideoRemux,
  streamSubtitle,
  checkFfmpeg
};
