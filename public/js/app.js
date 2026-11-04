/* global focusOverlay, hidePopoutPreview, loadLibrary, restoreFocus */
/* exported artworkUrl, closeSettingsModal, openSettingsModal, reportError, requestJson, rescanServer, saveSettings, setArtworkBackground, setOverlayVisible */

async function requestJson(url, { body, headers, ...options } = {}) {
  const response = await fetch(url, {
    ...options,
    ...(body === undefined
      ? {}
      : {
          headers: { 'Content-Type': 'application/json', ...headers },
          body: JSON.stringify(body),
        }),
  });
  const data = await response.json();
  if (!response.ok)
    throw new Error(data.error || `Request failed (${response.status})`);
  return data;
}

function reportError(error) {
  console.error('[Orange TV]', error);
}

function artworkUrl(value, fallback) {
  try {
    const url = new URL(value || fallback, window.location.href);
    if (['http:', 'https:'].includes(url.protocol)) return url.href;
  } catch (error) {
    reportError(error);
  }
  return new URL(fallback, window.location.href).href;
}

function setArtworkBackground(element, value, fallback) {
  element.style.backgroundImage = `url(${JSON.stringify(artworkUrl(value, fallback))})`;
}

function setOverlayVisible(element, visible) {
  element.classList.toggle('opacity-0', !visible);
  element.classList.toggle('pointer-events-none', !visible);
  element.inert = !visible;
  element.setAttribute('aria-hidden', String(!visible));
}

async function rescanServer() {
  const icon = document.getElementById('refreshIcon');
  icon.classList.add('animate-spin');
  try {
    await requestJson('/api/library/rescan', { method: 'POST' });
    await loadLibrary();
  } catch (error) {
    reportError(error);
    alert('Failed to rescan library: ' + error.message);
  } finally {
    icon.classList.remove('animate-spin');
  }
}

async function openSettingsModal() {
  try {
    const [status, settings] = await Promise.all([
      requestJson('/api/status'),
      requestJson('/api/settings'),
    ]);
    document.getElementById('settingsTvUrl').textContent =
      `http://${status.localIp}:${status.port}`;
    document.getElementById('extraPathsInput').value =
      settings.extraMediaPaths.join(', ');
  } catch (error) {
    reportError(error);
    alert('Failed to load settings: ' + error.message);
    return;
  }
  hidePopoutPreview(true);
  const modal = document.getElementById('settingsModal');
  const box = document.getElementById('settingsBox');
  setOverlayVisible(modal, true);
  box.classList.remove('scale-95');
  box.classList.add('scale-100');
  focusOverlay(modal);
}

function closeSettingsModal() {
  setOverlayVisible(document.getElementById('settingsModal'), false);
  const box = document.getElementById('settingsBox');
  box.classList.add('scale-95');
  box.classList.remove('scale-100');
  restoreFocus(document.getElementById('settingsModal'));
}

async function saveSettings() {
  const extraMediaPaths = document
    .getElementById('extraPathsInput')
    .value.split(',')
    .map((value) => value.trim())
    .filter(Boolean);
  try {
    await requestJson('/api/settings', {
      method: 'POST',
      body: { extraMediaPaths },
    });
    closeSettingsModal();
    await loadLibrary();
  } catch (error) {
    reportError(error);
    alert('Failed to save settings: ' + error.message);
  }
}

document.addEventListener('DOMContentLoaded', () => loadLibrary());
