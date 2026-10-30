const fs = require('fs');
const path = require('path');

const DATA_DIR = path.join(__dirname, '../data');
const PROGRESS_FILE = path.join(DATA_DIR, 'progress.json');

// Ensure data directory exists
if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}

function loadProgress() {
  if (!fs.existsSync(PROGRESS_FILE)) {
    return {};
  }
  try {
    const raw = fs.readFileSync(PROGRESS_FILE, 'utf8');
    return JSON.parse(raw);
  } catch (err) {
    console.warn('[Progress] Could not parse progress.json, resetting:', err.message);
    return {};
  }
}

function saveProgressStore(store) {
  try {
    fs.writeFileSync(PROGRESS_FILE, JSON.stringify(store, null, 2), 'utf8');
  } catch (err) {
    console.error('[Progress] Failed to save progress.json:', err.message);
  }
}

/**
 * Get all in-progress items, sorted by most recently watched.
 * Items watched past 92% are considered finished and filtered out of Continue Watching.
 */
function getContinueWatching(limit = 20) {
  const store = loadProgress();
  const list = Object.values(store)
    .filter(item => !item.completed && item.currentTime > 5 && item.percent < 92)
    .sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0))
    .slice(0, limit);

  return list;
}

/**
 * Get progress for a specific video ID.
 */
function getItemProgress(id) {
  const store = loadProgress();
  return store[id] || null;
}

/**
 * Save or update progress for a video.
 */
function updateProgress({ id, type, title, showTitle, season, episode, currentTime, duration, posterUrl }) {
  if (!id || typeof currentTime !== 'number') return null;

  const store = loadProgress();
  const dur = duration > 0 ? duration : (store[id]?.duration || 0);
  const percent = dur > 0 ? (currentTime / dur) * 100 : 0;
  const completed = percent >= 92;

  const record = {
    id,
    type: type || 'movie',
    title: title || 'Untitled',
    showTitle: showTitle || null,
    season: season || null,
    episode: episode || null,
    currentTime: Math.floor(currentTime),
    duration: Math.floor(dur),
    percent: Math.min(100, Math.max(0, Math.floor(percent))),
    completed,
    posterUrl: posterUrl || store[id]?.posterUrl || null,
    updatedAt: Date.now()
  };

  store[id] = record;
  saveProgressStore(store);
  return record;
}

/**
 * Remove an item from continue watching or delete history.
 */
function deleteProgress(id) {
  const store = loadProgress();
  if (store[id]) {
    delete store[id];
    saveProgressStore(store);
    return true;
  }
  return false;
}

module.exports = {
  getContinueWatching,
  getItemProgress,
  updateProgress,
  deleteProgress
};
