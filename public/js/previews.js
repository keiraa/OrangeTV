/* global artworkUrl, focusOverlay, formatTime, openDetails, playDirectMedia, restoreFocus, setOverlayVisible */
/* exported closeTrailerTheater, hidePopoutPreview, navigatePopout, seekTheaterVideo, showPopoutPreview, startMovieFromTheater, togglePopoutMute, toggleTheaterMute */

// Pop-out Preview State
let popoutHoverDebounce = null;
let popoutDwellTimer = null;
let popoutHideTimer = null;
let activePopoutItem = null;
let popoutMuted = true;
let activeTheaterItem = null;

// Floating 3x Pop-Out Preview Controller
let currentPopoutWrapper = null;

function showPopoutPreview(cardWrapper, item, immediate = false) {
  clearTimeout(popoutHideTimer);
  clearTimeout(popoutHoverDebounce);

  const renderPopout = () => {
    activePopoutItem = item;
    currentPopoutWrapper = cardWrapper;
    const popout = document.getElementById('cardPopoutPreview');
    const card = cardWrapper.querySelector('.tv-card') || cardWrapper;
    const rect = card.getBoundingClientRect();

    // 3x Pop-Out Dimensions (~440px width, clean 16:9 artwork window)
    const popWidth = Math.min(440, window.innerWidth - 32);
    const popHeight = 410;

    let left = rect.left + rect.width / 2 - popWidth / 2;
    let top = rect.top + rect.height / 2 - popHeight / 2;

    // Keep inside viewport with margins
    if (left < 16) left = 16;
    if (left + popWidth > window.innerWidth - 16)
      left = window.innerWidth - popWidth - 16;
    if (top < 70) top = 70;
    if (top + popHeight > window.innerHeight - 16)
      top = window.innerHeight - popHeight - 16;

    popout.style.left = `${left}px`;
    popout.style.top = `${top}px`;
    popout.style.width = `${popWidth}px`;
    popout.style.transform = '';

    // Content
    const poster =
      item.backdropUrl || item.posterUrl || `/api/backdrop/${item.id}`;
    document.getElementById('popoutPoster').src = artworkUrl(
      poster,
      `/api/poster/${item.id}`
    );
    document.getElementById('popoutTitle').textContent = item.title;
    document.getElementById('popoutYear').textContent = item.year || '2026';
    document.getElementById('popoutRating').textContent = item.rating
      ? `★ ${item.rating}`
      : '★ 8.8';
    document.getElementById('popoutViews').textContent =
      `${item.views || 0} views`;
    document.getElementById('popoutGenre').textContent =
      (item.genres && item.genres[0]) ||
      (item.type === 'tv' ? 'Series' : 'Cinema');
    document.getElementById('popoutOverview').textContent =
      item.overview || 'Stream high-definition cinema on Orange TV.';

    // Action button callbacks
    document.getElementById('popoutPlayBtn').onclick = (e) => {
      e.stopPropagation();
      hidePopoutPreview(true);
      playDirectMedia(item.id);
    };
    document.getElementById('popoutTheaterBtn').onclick = (e) => {
      e.stopPropagation();
      hidePopoutPreview(true);
      openTrailerTheater(item);
    };
    document.getElementById('popoutDetailsBtn').onclick = (e) => {
      e.stopPropagation();
      hidePopoutPreview(true);
      openDetails(item);
    };

    // Video Trailer Preview
    const popVideo = document.getElementById('popoutVideo');
    popVideo.pause();
    popVideo.style.opacity = '0';
    popVideo.muted = popoutMuted;
    if (item.trailerPath) {
      popVideo.src = `/api/trailer/${item.id}`;
      popVideo
        .play()
        .then(() => {
          if (activePopoutItem === item) popVideo.style.opacity = '1';
        })
        .catch(() => {
          popVideo.style.opacity = '0';
        });
    } else {
      popVideo.removeAttribute('src');
      popVideo.load();
    }

    // Show Pop-Out
    setOverlayVisible(popout, true);
    popout.classList.remove('scale-90');
    popout.classList.add('opacity-100', 'pointer-events-auto', 'scale-100');

    // Automatic 80% Screen Space Theater expansion on 5s dwell
    clearTimeout(popoutDwellTimer);
    popoutDwellTimer = setTimeout(() => {
      if (activePopoutItem === item) {
        hidePopoutPreview(true);
        openTrailerTheater(item);
      }
    }, 5000);
  };

  if (immediate) {
    renderPopout();
  } else {
    // 1 second (1000ms) hover delay for 3x pop-up
    popoutHoverDebounce = setTimeout(renderPopout, 1000);
  }
}

function hidePopoutPreview(immediate = false) {
  clearTimeout(popoutHoverDebounce);
  clearTimeout(popoutDwellTimer);

  const doHide = () => {
    const popout = document.getElementById('cardPopoutPreview');
    const popVideo = document.getElementById('popoutVideo');
    if (popout) {
      setOverlayVisible(popout, false);
      popout.classList.add('scale-90');
      popout.classList.remove(
        'opacity-100',
        'pointer-events-auto',
        'scale-100'
      );
      popout.style.transform = '';
    }
    if (popVideo) {
      popVideo.style.opacity = '0';
      popVideo.pause();
      popVideo.removeAttribute('src');
      popVideo.load();
    }
    activePopoutItem = null;
    currentPopoutWrapper = null;
  };

  if (immediate) {
    clearTimeout(popoutHideTimer);
    doHide();
  } else {
    clearTimeout(popoutHideTimer);
    popoutHideTimer = setTimeout(doHide, 160);
  }
}

function togglePopoutMute(e) {
  if (e) e.stopPropagation();
  const popVideo = document.getElementById('popoutVideo');
  const icon = document.getElementById('popoutMuteIcon');
  popoutMuted = !popoutMuted;
  if (popVideo) popVideo.muted = popoutMuted;
  if (icon) icon.textContent = popoutMuted ? '🔇' : '🔊';
}

// Navigate to previous/next card in the active carousel row
function navigatePopout(dir, event) {
  if (event) event.stopPropagation();
  if (!currentPopoutWrapper) return;
  const parentRow = currentPopoutWrapper.parentElement;
  if (!parentRow) return;

  const siblings = Array.from(parentRow.querySelectorAll('.tv-card-wrapper'));
  const currentIndex = siblings.indexOf(currentPopoutWrapper);
  if (currentIndex === -1) return;

  let nextIndex = currentIndex + dir;
  if (nextIndex < 0) nextIndex = siblings.length - 1;
  if (nextIndex >= siblings.length) nextIndex = 0;

  const targetCard = siblings[nextIndex];
  if (targetCard && targetCard.__itemData) {
    targetCard.scrollIntoView({
      behavior: 'smooth',
      inline: 'center',
      block: 'nearest',
    });
    showPopoutPreview(targetCard, targetCard.__itemData, true);
  }
}

// Connect pop-out hover persistence and mouse gestures for moving left and right
const popoutEl = document.getElementById('cardPopoutPreview');
if (popoutEl) {
  popoutEl.addEventListener('mouseenter', () => {
    clearTimeout(popoutHideTimer);
  });
  popoutEl.addEventListener('mouseleave', () => {
    hidePopoutPreview();
  });

  // Pointer / Mouse Drag gesture left and right
  let isDraggingPopout = false;
  let popoutDragStartX = 0;
  let popoutDragStartY = 0;

  popoutEl.addEventListener('pointerdown', (e) => {
    if (e.target.closest('button') || e.target.closest('input')) return;
    isDraggingPopout = true;
    popoutDragStartX = e.clientX;
    popoutDragStartY = e.clientY;
  });

  window.addEventListener('pointermove', (e) => {
    if (!isDraggingPopout) return;
    const diffX = e.clientX - popoutDragStartX;
    const diffY = e.clientY - popoutDragStartY;
    if (Math.abs(diffX) > 8 && Math.abs(diffX) > Math.abs(diffY)) {
      popoutEl.style.transform = `translateX(${diffX * 0.35}px) scale(1)`;
    }
  });

  window.addEventListener('pointerup', (e) => {
    if (!isDraggingPopout) return;
    isDraggingPopout = false;
    const diffX = e.clientX - popoutDragStartX;
    popoutEl.style.transform = '';
    if (diffX < -35) {
      navigatePopout(1); // Swiped Left -> Next Movie
    } else if (diffX > 35) {
      navigatePopout(-1); // Swiped Right -> Previous Movie
    }
  });

  // Mouse wheel / trackpad horizontal gesture for moving left and right
  let popoutWheelAccumulator = 0;
  let popoutWheelResetTimer = null;

  popoutEl.addEventListener(
    'wheel',
    (e) => {
      const dx = e.deltaX !== 0 ? e.deltaX : e.shiftKey ? e.deltaY : 0;
      if (Math.abs(dx) > 8) {
        popoutWheelAccumulator += dx;
        clearTimeout(popoutWheelResetTimer);
        popoutWheelResetTimer = setTimeout(() => {
          popoutWheelAccumulator = 0;
        }, 250);

        if (currentPopoutWrapper && currentPopoutWrapper.parentElement) {
          currentPopoutWrapper.parentElement.scrollLeft += dx;
        }

        if (popoutWheelAccumulator > 50) {
          popoutWheelAccumulator = 0;
          navigatePopout(1);
        } else if (popoutWheelAccumulator < -50) {
          popoutWheelAccumulator = 0;
          navigatePopout(-1);
        }
      }
    },
    { passive: true }
  );
}

// --- Immersive 80% Screen Space Trailer Theater Controller ---
function openTrailerTheater(item) {
  if (!item) return;

  hidePopoutPreview(true);

  activeTheaterItem = item;
  const theater = document.getElementById('trailerTheater');
  const box = document.getElementById('theaterBox');
  const video = document.getElementById('theaterVideo');

  document.getElementById('theaterTitle').textContent = item.title;
  document.getElementById('theaterYear').textContent =
    item.year || (item.type === 'tv' ? 'Series' : '2026');
  document.getElementById('theaterRating').textContent = item.rating
    ? `★ ${item.rating}`
    : '★ 8.8';
  document.getElementById('theaterViews').textContent =
    `${item.views || 0} views`;
  document.getElementById('theaterGenres').textContent =
    (item.genres || []).join(' • ') || 'Cinema';
  document.getElementById('theaterOverview').textContent =
    item.overview ||
    'Watch the official high-definition preview in the Orange TV Theater.';

  setOverlayVisible(theater, true);
  box.classList.remove('scale-95');
  box.classList.add('scale-100');
  focusOverlay(theater);

  video.poster = artworkUrl(
    item.backdropUrl || item.posterUrl,
    `/api/poster/${item.id}`
  );
  video.muted = false;
  updateTheaterMuteUI();
  document.getElementById('theaterProgressBar').style.width = '0%';
  document.getElementById('theaterTimeDisplay').textContent = '0:00 / 0:00';
  if (item.trailerPath) {
    video.src = `/api/trailer/${item.id}`;
    video.play().catch(() => {
      // Autoplay can require muted playback; artwork remains visible if it still fails.
      video.muted = true;
      updateTheaterMuteUI();
      video.play().catch(() => {});
    });
  } else {
    video.removeAttribute('src');
    video.load();
  }

  // Update progress bar and time indicator directly below the top title bar
  video.ontimeupdate = () => {
    if (Number.isFinite(video.duration) && video.duration > 0) {
      const pct = (video.currentTime / video.duration) * 100;
      document.getElementById('theaterProgressBar').style.width = `${pct}%`;
      document.getElementById('theaterTimeDisplay').textContent =
        `${formatTime(video.currentTime)} / ${formatTime(video.duration)}`;
    }
  };
}

function closeTrailerTheater() {
  const theater = document.getElementById('trailerTheater');
  const box = document.getElementById('theaterBox');
  const video = document.getElementById('theaterVideo');
  if (video) {
    video.pause();
    video.removeAttribute('src');
    video.load();
  }
  setOverlayVisible(theater, false);
  box.classList.add('scale-95');
  box.classList.remove('scale-100');
  restoreFocus(theater);
  activeTheaterItem = null;
}

function toggleTheaterMute() {
  const video = document.getElementById('theaterVideo');
  if (!video) return;
  video.muted = !video.muted;
  updateTheaterMuteUI();
}

function updateTheaterMuteUI() {
  const video = document.getElementById('theaterVideo');
  const icon = document.getElementById('theaterMuteIcon');
  const text = document.getElementById('theaterMuteText');
  if (!video || !icon || !text) return;
  if (video.muted) {
    icon.textContent = '🔇';
    text.textContent = 'Unmute';
  } else {
    icon.textContent = '🔊';
    text.textContent = 'Mute';
  }
}

function seekTheaterVideo(e) {
  const video = document.getElementById('theaterVideo');
  if (!video || !Number.isFinite(video.duration) || video.duration <= 0) return;
  const rect = e.currentTarget.getBoundingClientRect();
  const pos = (e.clientX - rect.left) / rect.width;
  video.currentTime = Math.max(
    0,
    Math.min(video.duration, pos * video.duration)
  );
}

function startMovieFromTheater() {
  const item = activeTheaterItem;
  closeTrailerTheater();
  if (item) {
    playDirectMedia(item.id);
  }
}
