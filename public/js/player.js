/* global activeModalItem, closeTrailerTheater, focusOverlay, hidePopoutPreview, loadLibrary, reportError, requestJson, restoreFocus, setOverlayVisible */
/* exported closePlayer, formatTime, launchStream, launchTrailer, seekVideo, skipSeconds, toggleFullscreen, togglePlayPause, toggleSubsMenu, video */

const video = document.getElementById('mainVideo');
let currentlyPlayingMedia = null;
let progressTimer = null;
let launchGeneration = 0;
let pendingProgress = Promise.resolve();

function launchTrailer(media) {
  return launchStream({
    ...media,
    title: `${media.title || media.showTitle} (Trailer)`,
    streamUrl: `/api/trailer/${media.id}`,
    isTrailer: true,
  });
}

async function launchStream(media) {
  const generation = ++launchGeneration;
  const previousSave = saveCurrentProgress();
  clearInterval(progressTimer);
  video.pause();
  video.removeAttribute('src');
  video.load();
  currentlyPlayingMedia = null;
  await previousSave;
  if (generation !== launchGeneration) return;
  hidePopoutPreview(true);
  closeTrailerTheater();
  let progress = null;
  if (!media.isTrailer) {
    try {
      progress = await requestJson(
        `/api/progress?id=${encodeURIComponent(media.id)}`
      );
    } catch (error) {
      reportError(error);
    }
  }
  if (generation !== launchGeneration) return;
  currentlyPlayingMedia = media;
  document.getElementById('playerTitle').textContent =
    media.title || media.showTitle;
  document.getElementById('playerSubtitle').textContent = media.showTitle
    ? `Season ${media.season} • Episode ${media.episode}`
    : 'Orange TV';
  const overlay = document.getElementById('playerOverlay');
  setOverlayVisible(overlay, true);
  focusOverlay(overlay);
  document.getElementById('playerPlayPauseBtn').focus();
  const subsList = document.getElementById('subsList');
  subsList.replaceChildren();
  video.replaceChildren();
  for (const sub of [null, ...(media.subtitles || [])]) {
    const button = document.createElement('button');
    button.className =
      'w-full text-left px-2.5 py-1.5 text-xs rounded-lg hover:bg-white/10 text-white flex items-center justify-between';
    button.textContent = sub?.label || (sub ? 'Subtitles' : 'Off');
    button.onclick = () => setSubtitle(sub?.id);
    subsList.appendChild(button);
    if (!sub) continue;
    const track = document.createElement('track');
    track.kind = 'subtitles';
    track.label = sub.label || 'Subtitles';
    track.srclang = sub.label?.startsWith('Spanish')
      ? 'es'
      : sub.label?.startsWith('French')
        ? 'fr'
        : 'en';
    track.dataset.subtitleId = sub.id;
    track.src = `/api/subtitles/${encodeURIComponent(sub.id)}`;
    video.appendChild(track);
  }
  video.onloadedmetadata = () => {
    if (generation !== launchGeneration) return;
    if (
      progress &&
      !progress.completed &&
      progress.currentTime > 5 &&
      Number.isFinite(video.duration)
    ) {
      video.currentTime = Math.min(
        progress.currentTime,
        Math.max(0, video.duration - 1)
      );
    }
  };
  video.src = media.streamUrl || `/api/stream/${encodeURIComponent(media.id)}`;
  video.play().catch(playbackError);
  if (!media.isTrailer) {
    progressTimer = setInterval(saveCurrentProgress, 5000);
    requestJson(`/api/view/${encodeURIComponent(media.id)}`, { method: 'POST' })
      .then((data) => {
        media.views = data.views;
        if (activeModalItem?.id === media.id)
          document.getElementById('modalViewsCount').textContent =
            `${data.views} Views`;
      })
      .catch(reportError);
  }
}

async function closePlayer() {
  const generation = ++launchGeneration;
  const saved = saveCurrentProgress();
  clearInterval(progressTimer);
  currentlyPlayingMedia = null;
  video.pause();
  video.removeAttribute('src');
  video.load();
  setOverlayVisible(document.getElementById('playerOverlay'), false);
  document.getElementById('subsMenu').classList.add('hidden');
  if (document.fullscreenElement)
    document.exitFullscreen?.().catch(reportError);
  restoreFocus(document.getElementById('playerOverlay'));
  await saved;
  if (generation === launchGeneration) await loadLibrary();
}

function playbackError(error) {
  if (error.name === 'AbortError') return;
  reportError(error);
  document.getElementById('playerSubtitle').textContent =
    error.name === 'NotAllowedError'
      ? 'Press Play to start playback'
      : 'Unable to play this file in this browser';
}

function setPlayingState(playing) {
  document.getElementById('playIcon').classList.toggle('hidden', playing);
  document.getElementById('pauseIcon').classList.toggle('hidden', !playing);
}

function togglePlayPause() {
  if (video.paused) video.play().catch(playbackError);
  else video.pause();
}

function skipSeconds(seconds) {
  if (Number.isFinite(video.duration))
    video.currentTime = Math.max(
      0,
      Math.min(video.duration, video.currentTime + seconds)
    );
}

function seekVideo(event) {
  if (!Number.isFinite(video.duration)) return;
  const rect = event.currentTarget.getBoundingClientRect();
  video.currentTime =
    Math.max(0, Math.min(1, (event.clientX - rect.left) / rect.width)) *
    video.duration;
}

video.addEventListener('play', () => setPlayingState(true));
video.addEventListener('pause', () => setPlayingState(false));
video.addEventListener('error', () => {
  if (video.getAttribute('src'))
    playbackError(new Error('Media playback failed'));
});
video.addEventListener('ended', () => {
  clearInterval(progressTimer);
  saveCurrentProgress();
});
video.addEventListener('timeupdate', () => {
  const duration = Number.isFinite(video.duration) ? video.duration : 0;
  const percent = duration ? (video.currentTime / duration) * 100 : 0;
  document.getElementById('playerScrubberProgress').style.width = `${percent}%`;
  document.getElementById('playerScrubberKnob').style.left = `${percent}%`;
  document.getElementById('playerCurrentTime').textContent = formatTime(
    video.currentTime
  );
  document.getElementById('playerDuration').textContent = formatTime(duration);
});

function formatTime(seconds) {
  const value = Number.isFinite(seconds) ? Math.max(0, seconds) : 0;
  return `${Math.floor(value / 60)
    .toString()
    .padStart(2, '0')}:${Math.floor(value % 60)
    .toString()
    .padStart(2, '0')}`;
}

function toggleSubsMenu(event) {
  event.stopPropagation();
  const menu = document.getElementById('subsMenu');
  menu.classList.toggle('hidden');
  if (!menu.classList.contains('hidden')) focusOverlay(menu);
}

function setSubtitle(id) {
  for (const track of video.querySelectorAll('track')) {
    track.track.mode = track.dataset.subtitleId === id ? 'showing' : 'disabled';
  }
  document.getElementById('subsMenu').classList.add('hidden');
  restoreFocus(document.getElementById('subsMenu'));
}

function toggleFullscreen() {
  const action = document.fullscreenElement
    ? document.exitFullscreen?.()
    : document.getElementById('playerOverlay').requestFullscreen?.();
  action?.catch(reportError);
}

function saveCurrentProgress() {
  const media = currentlyPlayingMedia;
  if (
    !media ||
    media.isTrailer ||
    !Number.isFinite(video.duration) ||
    video.duration <= 0 ||
    video.currentTime < 2
  )
    return pendingProgress;
  const body = {
    id: media.id,
    currentTime: Math.floor(video.currentTime),
    duration: Math.floor(video.duration),
  };
  pendingProgress = pendingProgress
    .then(() => requestJson('/api/progress', { method: 'POST', body }))
    .catch((error) => {
      reportError(error);
      document.getElementById('playerSubtitle').textContent =
        'Progress could not be saved';
    });
  return pendingProgress;
}
