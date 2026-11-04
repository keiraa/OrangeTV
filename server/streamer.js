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
};

// Check if ffmpeg binary exists
let ffmpegCheck = null;
function checkFfmpeg() {
  if (ffmpegCheck) return ffmpegCheck;
  ffmpegCheck = new Promise((resolve) => {
    const proc = spawn('ffmpeg', ['-version']);
    proc.stdout.resume();
    proc.stderr.resume();
    proc.once('error', () => resolve(false));
    proc.once('close', (code) => resolve(code === 0));
  });
  return ffmpegCheck;
}

function fileError(res, err) {
  if (res.destroyed) return;
  if (res.headersSent) return res.destroy(err);
  res.removeHeader('Content-Length');
  res.removeHeader('Content-Range');
  const status = ['ENOENT', 'ENOTDIR'].includes(err.code)
    ? 404
    : ['EACCES', 'EPERM'].includes(err.code)
      ? 403
      : 500;
  return res
    .status(status)
    .type('json')
    .json({
      error: status === 404 ? 'File not found' : 'Unable to read media',
    });
}

/**
 * Serve byte ranges without transcoding or buffering the whole video.
 */
function streamVideoDirect(req, res, filePath) {
  let fd;
  let stat;
  try {
    fd = fs.openSync(filePath, 'r');
    stat = fs.fstatSync(fd);
    if (!stat.isFile())
      throw Object.assign(new Error('Not a regular file'), { code: 'ENOENT' });
  } catch (err) {
    if (fd !== undefined) fs.closeSync(fd);
    return fileError(res, err);
  }
  const fileSize = stat.size;
  let start = 0;
  let end = fileSize - 1;
  const range = req.headers.range;
  if (range) {
    // Multiple ranges are deliberately unsupported; never silently return the wrong bytes.
    const match = /^bytes=(\d*)-(\d*)$/.exec(range);
    let valid = !!match && !!(match[1] || match[2]) && fileSize > 0;
    if (valid && !match[1]) {
      const suffix = Number(match[2]);
      valid = Number.isSafeInteger(suffix) && suffix > 0;
      start = Math.max(0, fileSize - suffix);
    } else if (valid) {
      start = Number(match[1]);
      const requestedEnd = match[2] ? Number(match[2]) : end;
      valid =
        Number.isSafeInteger(start) &&
        Number.isSafeInteger(requestedEnd) &&
        start < fileSize &&
        requestedEnd >= start;
      end = Math.min(requestedEnd, end);
    }
    if (!valid) {
      fs.closeSync(fd);
      res.status(416).set({
        'Content-Range': `bytes */${fileSize}`,
        'Accept-Ranges': 'bytes',
      });
      return res.end();
    }
    res.status(206).set('Content-Range', `bytes ${start}-${end}/${fileSize}`);
  }
  res.set({
    'Content-Length': fileSize ? end - start + 1 : 0,
    'Accept-Ranges': 'bytes',
    'Content-Type':
      MIME_MAP[path.extname(filePath).toLowerCase()] || 'video/mp4',
    'Cache-Control': 'no-cache, no-store, must-revalidate',
  });
  if (!fileSize || req.method === 'HEAD') {
    fs.closeSync(fd);
    return res.end();
  }
  const stream = fs.createReadStream(filePath, { fd, start, end });
  res.once('close', () => stream.destroy());
  stream.once('error', (err) => fileError(res, err));
  stream.pipe(res);
}

/**
 * Stream video with on-the-fly FFmpeg container/audio remuxing (stream-copy, no heavy video encoding).
 */
async function streamVideoRemux(req, res, filePath, startTimeSeconds = 0) {
  if (!Number.isFinite(startTimeSeconds) || startTimeSeconds < 0) {
    return res.status(400).json({ error: 'Invalid start time' });
  }
  try {
    if (!fs.statSync(filePath).isFile())
      throw Object.assign(new Error('Not a file'), { code: 'ENOENT' });
    fs.accessSync(filePath, fs.constants.R_OK);
  } catch (err) {
    return fileError(res, err);
  }
  const hasFfmpeg = await checkFfmpeg();
  if (res.destroyed) return;
  if (!hasFfmpeg) {
    console.warn(
      '[Streamer] FFmpeg not found on system; falling back to direct play'
    );
    return streamVideoDirect(req, res, filePath);
  }

  res.set({
    'Content-Type': 'video/mp4',
    'Accept-Ranges': 'none',
    'Cache-Control': 'no-cache',
  });
  if (req.method === 'HEAD') return res.end();

  const args = [
    '-nostdin',
    '-v',
    'error',
    '-ss',
    String(startTimeSeconds),
    '-i',
    filePath,
    '-c:v',
    'copy',
    '-c:a',
    'aac',
    '-b:a',
    '192k',
    '-f',
    'mp4',
    '-movflags',
    'frag_keyframe+empty_moov+default_base_moof',
    'pipe:1',
  ];

  const ffmpegProc = spawn('ffmpeg', args);

  res.once('close', () => {
    if (ffmpegProc.exitCode === null) ffmpegProc.kill();
  });
  // Wait for process exit before ending the response, so failures cannot look successful.
  ffmpegProc.stdout.pipe(res, { end: false });
  ffmpegProc.stdout.once('error', (err) => fileError(res, err));
  let diagnostic = '';
  ffmpegProc.stderr.on('data', (chunk) => {
    diagnostic = (diagnostic + chunk.toString()).slice(-2048);
  });
  let failed = false;
  ffmpegProc.once('error', (err) => {
    failed = true;
    if (err.code === 'ENOENT' && !res.headersSent)
      return streamVideoDirect(req, res, filePath);
    fileError(res, err);
  });
  ffmpegProc.once('close', (code) => {
    if (failed || res.destroyed) return;
    if (code !== 0) {
      console.error('[Streamer] FFmpeg failed:', diagnostic.trim());
      return fileError(res, new Error('FFmpeg remux failed'));
    }
    res.end();
  });
}

/**
 * Serve subtitle file in standard WebVTT format (converts SRT on-the-fly).
 */
function streamSubtitle(req, res, subtitlePath) {
  const ext = path.extname(subtitlePath).toLowerCase();

  res.setHeader('Content-Type', 'text/vtt; charset=utf-8');
  res.setHeader('Cache-Control', 'public, max-age=86400');

  if (ext === '.vtt') {
    const stream = fs.createReadStream(subtitlePath);
    stream.once('error', (err) => fileError(res, err));
    res.once('close', () => stream.destroy());
    stream.pipe(res);
  } else if (ext === '.srt') {
    fs.readFile(subtitlePath, 'utf8', (err, data) => {
      if (res.destroyed) return;
      if (err) return fileError(res, err);
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
  checkFfmpeg,
};
