const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const VIDEO_EXTENSIONS = new Set(['.mp4', '.mkv', '.webm', '.m4v', '.mov', '.avi']);
const SUBTITLE_EXTENSIONS = new Set(['.srt', '.vtt']);
const IMAGE_EXTENSIONS = new Set(['.jpg', '.jpeg', '.png', '.webp']);

/**
 * Generate a short deterministic ID from file path.
 */
function generateId(filePath) {
  return crypto.createHash('md5').update(filePath).digest('hex').slice(0, 12);
}

/**
 * Clean a raw filename to extract human-readable title and year.
 */
function parseMediaInfo(filename, parentDirName) {
  const ext = path.extname(filename);
  let nameWithoutExt = path.basename(filename, ext);

  // Strip leading site prefixes like "www.5MovieRulz.company - "
  nameWithoutExt = nameWithoutExt.replace(/^(?:www\.)?[a-zA-Z0-9-]+\.[a-zA-Z0-9.-]+\s*[-_:]*\s*/i, '');
  let cleanParentDir = parentDirName.replace(/^(?:www\.)?[a-zA-Z0-9-]+\.[a-zA-Z0-9.-]+\s*[-_:]*\s*/i, '');

  // Check for TV Show pattern: S01E02, Season 1 Episode 2, 1x02
  const tvMatch = nameWithoutExt.match(/(?:s|season\s*)(\d{1,2})(?:e|ep|episode\s*)(\d{1,2})/i) ||
                  nameWithoutExt.match(/(?:^|[\s._-])(\d{1,2})x(\d{1,2})(?:[\s._-]|$)/i);

  if (tvMatch) {
    const season = parseInt(tvMatch[1], 10);
    const episode = parseInt(tvMatch[2], 10);
    
    // Clean show title: take part before the SxxExx or use parent directory
    let showTitle = nameWithoutExt.substring(0, tvMatch.index).replace(/[._-]/g, ' ').trim();
    if (!showTitle || showTitle.length < 2) {
      showTitle = cleanParentDir.replace(/[._-]/g, ' ').replace(/season\s*\d+/i, '').trim();
    }
    showTitle = cleanTags(showTitle);
    
    // Clean episode title: take part after SxxExx if present
    let episodeTitle = nameWithoutExt.substring(tvMatch.index + tvMatch[0].length).replace(/[._-]/g, ' ').trim();
    episodeTitle = cleanTags(episodeTitle);
    if (!episodeTitle) {
      episodeTitle = `Episode ${episode}`;
    }

    return {
      type: 'tv',
      showTitle: titleCase(showTitle),
      season,
      episode,
      episodeTitle: titleCase(episodeTitle)
    };
  }

  // Check for Movie Year: (2020), .2020., [2020]
  const yearMatch = nameWithoutExt.match(/(?:[([.\s_-])((?:19|20)\d{2})(?:[)\]\s_.-]|$)/);
  let year = null;
  let title = nameWithoutExt;

  if (yearMatch) {
    year = parseInt(yearMatch[1], 10);
    title = nameWithoutExt.substring(0, yearMatch.index);
  }

  title = cleanTags(title.replace(/[._-]/g, ' ')).trim();
  if (!title && cleanParentDir) {
    title = cleanTags(cleanParentDir.replace(/[._-]/g, ' ')).trim();
  }

  return {
    type: 'movie',
    title: titleCase(title) || nameWithoutExt,
    year
  };
}

/**
 * Remove standard release group / codec tags.
 */
function cleanTags(str) {
  // Strip website domains inside string
  str = str.replace(/(?:www\.)?[a-zA-Z0-9-]+\.[a-zA-Z]{2,}(?:\.[a-zA-Z]{2,})?/gi, ' ');
  // Strip brackets with codec/audio/site info like [BluRay] [1080p] [YTS.AM]
  str = str.replace(/\[[^\]]*\]/g, ' ');
  // Strip audio / codec / language / quality / site tags
  const garbageRegex = /\b(1080p|720p|4k|2160p|480p|uhd|bluray|blu-ray|web-dl|webrip|hdtv|x264|x265|hevc|avc|aac|dts|ac3|atmos|remux|repack|yify|rarbg|eztv|esub|telugu|tamil|hindi|kannada|malayalam|true|hq|hdrip|brrip|rip)\b/gi;
  str = str.replace(garbageRegex, ' ');
  // Strip patterns like (DD+5.1 - 192Kbps) or - 1.6GB
  str = str.replace(/\([^)]*(?:kbps|dd|aac|hevc|5\.1|atmos)[^)]*\)/gi, ' ');
  str = str.replace(/\b\d+(?:\.\d+)?\s*(?:gb|mb)\b/gi, ' ');
  return str.replace(/[._-]/g, ' ').replace(/\s+/g, ' ').trim();
}

/**
 * Convert string to Title Case.
 */
function titleCase(str) {
  return str.replace(/\w\S*/g, (txt) => txt.charAt(0).toUpperCase() + txt.substr(1).toLowerCase());
}

/**
 * Recursively find all files in a directory.
 */
function scanDirectoryRecursive(dirPath, fileList = []) {
  if (!fs.existsSync(dirPath)) return fileList;

  try {
    const entries = fs.readdirSync(dirPath, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.name.startsWith('.')) continue; // skip hidden files

      const fullPath = path.join(dirPath, entry.name);
      if (entry.isDirectory()) {
        scanDirectoryRecursive(fullPath, fileList);
      } else if (entry.isFile()) {
        fileList.push(fullPath);
      }
    }
  } catch (err) {
    console.warn(`[Scanner] Warning reading directory ${dirPath}:`, err.message);
  }

  return fileList;
}

/**
 * Scan all configured media roots and build library catalog.
 */
function scanLibrary(rootDirs) {
  const allFiles = [];
  for (const root of rootDirs) {
    if (fs.existsSync(root)) {
      scanDirectoryRecursive(root, allFiles);
    }
  }

  const videoFiles = [];
  const subtitleFiles = [];
  const imageFiles = [];

  for (const file of allFiles) {
    const ext = path.extname(file).toLowerCase();
    if (VIDEO_EXTENSIONS.has(ext)) videoFiles.push(file);
    else if (SUBTITLE_EXTENSIONS.has(ext)) subtitleFiles.push(file);
    else if (IMAGE_EXTENSIONS.has(ext)) imageFiles.push(file);
  }

  const movies = [];
  const tvMap = new Map(); // showTitle -> { title, seasons: { [seasonNum]: [episodes] } }

  for (const videoPath of videoFiles) {
    const filename = path.basename(videoPath);
    if (filename.toLowerCase().startsWith('trailer.') || filename.toLowerCase().includes('-trailer.')) {
      continue; // Skip trailers from being added as standalone full movies
    }

    const stat = fs.statSync(videoPath);
    const parentDir = path.dirname(videoPath);
    const parentDirName = path.basename(parentDir);
    const ext = path.extname(videoPath).toLowerCase();
    const id = generateId(videoPath);

    // Find associated subtitles in the same directory
    const baseNameNoExt = path.basename(videoPath, ext);
    const matchedSubtitles = subtitleFiles
      .filter(sub => {
        const subDir = path.dirname(sub);
        if (subDir !== parentDir) return false;
        const subBase = path.basename(sub, path.extname(sub));
        return subBase.toLowerCase().startsWith(baseNameNoExt.toLowerCase()) ||
               subBase.toLowerCase() === 'sub' ||
               subBase.toLowerCase().includes('en');
      })
      .map(sub => {
        const subExt = path.extname(sub).toLowerCase();
        let lang = 'English';
        if (sub.toLowerCase().includes('.es.') || sub.toLowerCase().endsWith('.es.srt')) lang = 'Spanish';
        if (sub.toLowerCase().includes('.fr.') || sub.toLowerCase().endsWith('.fr.srt')) lang = 'French';
        return {
          id: generateId(sub),
          path: sub,
          filename: path.basename(sub),
          format: subExt.replace('.', ''),
          label: `${lang} (${subExt.replace('.', '').toUpperCase()})`
        };
      });

    // Find local poster if available in directory
    const localPoster = imageFiles.find(img => {
      const imgDir = path.dirname(img);
      if (imgDir === parentDir && !rootDirs.includes(parentDir)) {
        return true; // Use image in dedicated movie subfolder as poster
      }
      if (imgDir !== parentDir && imgDir !== path.dirname(parentDir)) return false;
      const imgName = path.basename(img).toLowerCase();
      return imgName.includes('poster') || imgName.includes('cover') || imgName.includes('folder') ||
             imgName.startsWith(baseNameNoExt.toLowerCase());
    });

    const info = parseMediaInfo(filename, parentDirName);

    if (info.type === 'movie') {
      const trailerCandidate = path.join(parentDir, 'trailer.mp4');
      const trailerPath = fs.existsSync(trailerCandidate) ? trailerCandidate : null;
      const imagesDirPoster = path.join(parentDir, 'images/poster.jpg');
      const imagesDirBackdrop = path.join(parentDir, 'images/backdrop.jpg');

      movies.push({
        id,
        type: 'movie',
        title: info.title,
        year: info.year,
        filePath: videoPath,
        filename,
        fileSize: stat.size,
        extension: ext,
        subtitles: matchedSubtitles,
        trailerPath,
        localPoster: fs.existsSync(imagesDirPoster) ? imagesDirPoster : (localPoster || null),
        localBackdrop: fs.existsSync(imagesDirBackdrop) ? imagesDirBackdrop : null,
        addedAt: stat.mtimeMs
      });
    } else {
      // TV Episode
      const showKey = info.showTitle.toLowerCase();
      let showDir = parentDir;
      if (/season\s*\d+/i.test(parentDirName)) {
        showDir = path.dirname(parentDir);
      }
      const showImagesPoster = path.join(showDir, 'images/poster.jpg');
      const showImagesBackdrop = path.join(showDir, 'images/backdrop.jpg');
      const showTrailerCandidate = path.join(showDir, 'trailer.mp4');

      if (!tvMap.has(showKey)) {
        tvMap.set(showKey, {
          id: generateId(info.showTitle),
          type: 'tv',
          title: info.showTitle,
          trailerPath: fs.existsSync(showTrailerCandidate) ? showTrailerCandidate : null,
          localPoster: fs.existsSync(showImagesPoster) ? showImagesPoster : (localPoster || null),
          localBackdrop: fs.existsSync(showImagesBackdrop) ? showImagesBackdrop : null,
          seasons: {}
        });
      }

      const show = tvMap.get(showKey);
      if (!show.localPoster && fs.existsSync(showImagesPoster)) {
        show.localPoster = showImagesPoster;
      }
      if (!show.localBackdrop && fs.existsSync(showImagesBackdrop)) {
        show.localBackdrop = showImagesBackdrop;
      }
      if (!show.trailerPath && fs.existsSync(showTrailerCandidate)) {
        show.trailerPath = showTrailerCandidate;
      }

      if (!show.seasons[info.season]) {
        show.seasons[info.season] = [];
      }

      show.seasons[info.season].push({
        id,
        type: 'episode',
        showTitle: info.showTitle,
        season: info.season,
        episode: info.episode,
        title: info.episodeTitle,
        filePath: videoPath,
        filename,
        fileSize: stat.size,
        extension: ext,
        subtitles: matchedSubtitles,
        addedAt: stat.mtimeMs
      });
    }
  }

  // Sort TV episodes inside seasons
  const tvShows = Array.from(tvMap.values()).map(show => {
    const formattedSeasons = [];
    const seasonNums = Object.keys(show.seasons).map(Number).sort((a, b) => a - b);
    for (const sNum of seasonNums) {
      show.seasons[sNum].sort((a, b) => a.episode - b.episode);
      formattedSeasons.push({
        seasonNumber: sNum,
        episodes: show.seasons[sNum]
      });
    }
    return {
      ...show,
      seasons: formattedSeasons
    };
  });

  // Sort movies by title
  movies.sort((a, b) => a.title.localeCompare(b.title));
  tvShows.sort((a, b) => a.title.localeCompare(b.title));

  return {
    movies,
    tvShows,
    scannedAt: new Date().toISOString()
  };
}

module.exports = {
  scanLibrary,
  parseMediaInfo,
  generateId
};
