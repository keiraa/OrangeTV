/* global closeDetails, closePlayer, closeSettingsModal, closeTrailerTheater, hidePopoutPreview, navigatePopout, skipSeconds, toggleFullscreen, togglePlayPause, video */
/* exported focusOverlay, restoreFocus */

const focusStack = [];

function visibleControls(scope) {
  return [
    ...scope.querySelectorAll(
      'button, input, select, a[href], [tabindex]:not([tabindex="-1"])'
    ),
  ].filter(
    (element) =>
      !element.disabled &&
      element.getClientRects().length &&
      !element.closest('.pointer-events-none, .hidden')
  );
}

function focusOverlay(overlay) {
  if (focusStack.at(-1)?.overlay !== overlay)
    focusStack.push({ overlay, previous: document.activeElement });
  visibleControls(overlay)[0]?.focus();
}

function restoreFocus(overlay) {
  const index = focusStack.findIndex((entry) => entry.overlay === overlay);
  if (index < 0) return;
  const [{ previous }] = focusStack.splice(index);
  if (
    previous?.isConnected &&
    !previous.closest('.pointer-events-none, .hidden')
  )
    previous.focus();
}

function activeScope() {
  for (const id of [
    'settingsModal',
    'playerOverlay',
    'trailerTheater',
    'detailModal',
    'cardPopoutPreview',
  ]) {
    const element = document.getElementById(id);
    if (!element.classList.contains('pointer-events-none')) {
      const subtitles = document.getElementById('subsMenu');
      return id === 'playerOverlay' && !subtitles.classList.contains('hidden')
        ? subtitles
        : element;
    }
  }
  return document.body;
}

function moveFocus(key, scope) {
  const controls = visibleControls(scope);
  const current = document.activeElement;
  if (!controls.includes(current)) {
    controls[0]?.focus();
    return;
  }
  const horizontal = key === 'ArrowLeft' || key === 'ArrowRight';
  const sign = key === 'ArrowLeft' || key === 'ArrowUp' ? -1 : 1;
  const origin = current.getBoundingClientRect();
  let nearest = null;
  let bestScore = Infinity;
  for (const candidate of controls) {
    if (
      candidate === current ||
      candidate.contains(current) ||
      current.contains(candidate)
    )
      continue;
    const rect = candidate.getBoundingClientRect();
    const dx = rect.left + rect.width / 2 - (origin.left + origin.width / 2);
    const dy = rect.top + rect.height / 2 - (origin.top + origin.height / 2);
    const forward = (horizontal ? dx : dy) * sign;
    if (forward <= 1) continue;
    const score = forward + Math.abs(horizontal ? dy : dx) * 3;
    if (score < bestScore) {
      nearest = candidate;
      bestScore = score;
    }
  }
  nearest?.focus();
  nearest?.scrollIntoView({
    block: 'nearest',
    inline: 'nearest',
    behavior: 'smooth',
  });
}

window.addEventListener('keydown', (event) => {
  const key =
    event.key ||
    {
      13: 'Enter',
      32: ' ',
      37: 'ArrowLeft',
      38: 'ArrowUp',
      39: 'ArrowRight',
      40: 'ArrowDown',
      70: 'f',
    }[event.keyCode] ||
    '';
  const editing = event.target.matches(
    'input, textarea, select, [contenteditable="true"]'
  );
  const scope = activeScope();
  const back =
    ['Escape', 'BrowserBack'].includes(key) ||
    (!editing && key === 'Backspace') ||
    [461, 10009].includes(event.keyCode);
  if (back) {
    const actions = {
      settingsModal: closeSettingsModal,
      playerOverlay: closePlayer,
      trailerTheater: closeTrailerTheater,
      detailModal: closeDetails,
      cardPopoutPreview: () => hidePopoutPreview(true),
      subsMenu: () => {
        scope.classList.add('hidden');
        restoreFocus(scope);
      },
    };
    if (actions[scope.id]) {
      event.preventDefault();
      actions[scope.id]();
    }
    return;
  }
  if (key === 'Tab') {
    const controls = visibleControls(scope);
    if (!controls.length) return;
    event.preventDefault();
    const index = controls.indexOf(document.activeElement);
    controls[
      (index + (event.shiftKey ? -1 : 1) + controls.length) % controls.length
    ].focus();
    return;
  }
  if (editing) return;
  const arrow = ['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(
    event.key
  );
  if (arrow) document.body.classList.add('tv-mode');
  if (scope.id === 'playerOverlay') {
    if (
      [' ', 'MediaPlayPause', 'MediaPlay', 'MediaPause'].includes(key) ||
      [415, 19].includes(event.keyCode)
    ) {
      event.preventDefault();
      togglePlayPause();
      return;
    }
    if (arrow) {
      event.preventDefault();
      if (key === 'ArrowLeft') skipSeconds(-10);
      else if (key === 'ArrowRight') skipSeconds(10);
      else
        video.volume = Math.max(
          0,
          Math.min(1, video.volume + (key === 'ArrowUp' ? 0.1 : -0.1))
        );
      return;
    }
    if (key.toLowerCase() === 'f') {
      event.preventDefault();
      toggleFullscreen();
      return;
    }
  }
  if (
    scope.id === 'cardPopoutPreview' &&
    ['ArrowLeft', 'ArrowRight'].includes(key)
  ) {
    event.preventDefault();
    navigatePopout(key === 'ArrowRight' ? 1 : -1);
    return;
  }
  if (arrow) {
    event.preventDefault();
    moveFocus(key, scope);
  }
  if (key === 'Enter' && !event.target.closest('button, a, input, select')) {
    const target = event.target.closest('[tabindex="0"]');
    if (target) {
      event.preventDefault();
      target.click();
    }
  }
});

window.addEventListener('mousedown', () =>
  document.body.classList.remove('tv-mode')
);
