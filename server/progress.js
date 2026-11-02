const path = require('path');
const { readJson, writeJson } = require('./json-store');

const DEFAULT_FILE = path.join(__dirname, '../data/progress.json');

function validProgress(store) {
  return (
    store !== null &&
    typeof store === 'object' &&
    !Array.isArray(store) &&
    Object.values(store).every(
      (item) =>
        item &&
        typeof item === 'object' &&
        typeof item.id === 'string' &&
        Number.isFinite(item.currentTime) &&
        item.currentTime >= 0 &&
        Number.isFinite(item.duration) &&
        item.duration >= 0 &&
        Number.isFinite(item.percent) &&
        item.percent >= 0 &&
        item.percent <= 100
    )
  );
}

function getContinueWatching(limit = 20, file = DEFAULT_FILE) {
  return Object.values(readJson(file, {}, validProgress))
    .filter(
      (item) => !item.completed && item.currentTime > 5 && item.percent < 92
    )
    .sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0))
    .slice(0, limit);
}

function getItemProgress(id, file = DEFAULT_FILE) {
  const store = readJson(file, {}, validProgress);
  return Object.hasOwn(store, id) ? store[id] : null;
}

function updateProgress(
  {
    id,
    type,
    title,
    showTitle,
    season,
    episode,
    currentTime,
    duration,
    posterUrl,
  },
  file = DEFAULT_FILE
) {
  if (
    typeof id !== 'string' ||
    !id ||
    !Number.isFinite(currentTime) ||
    currentTime < 0 ||
    (duration !== undefined && (!Number.isFinite(duration) || duration < 0))
  )
    return null;
  const store = readJson(file, {}, validProgress);
  const previous = Object.hasOwn(store, id) ? store[id] : null;
  const dur = duration > 0 ? duration : previous?.duration || 0;
  const percent = dur > 0 ? (currentTime / dur) * 100 : 0;
  const record = {
    id,
    type: type || 'movie',
    title: title || 'Untitled',
    showTitle: showTitle || null,
    season: season ?? null,
    episode: episode ?? null,
    currentTime: Math.floor(currentTime),
    duration: Math.floor(dur),
    percent: Math.min(100, Math.max(0, Math.floor(percent))),
    completed: percent >= 92,
    posterUrl: posterUrl || previous?.posterUrl || null,
    updatedAt: Date.now(),
  };
  writeJson(file, { ...store, [id]: record }, validProgress);
  return record;
}

function deleteProgress(id, file = DEFAULT_FILE) {
  const store = readJson(file, {}, validProgress);
  if (!Object.hasOwn(store, id)) return false;
  delete store[id];
  writeJson(file, store, validProgress);
  return true;
}

module.exports = {
  getContinueWatching,
  getItemProgress,
  updateProgress,
  deleteProgress,
};
