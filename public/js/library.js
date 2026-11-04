/* global artworkUrl, focusOverlay, hidePopoutPreview, launchStream, launchTrailer, reportError, requestJson, restoreFocus, setArtworkBackground, showPopoutPreview, setOverlayVisible */
/* exported activeModalItem, closeDetails, cycleHero, handleSearch, loadLibrary, openDetails, openHeroDetails, playCurrentHero, playCurrentHeroTrailer, playDirectMedia, playModalItem, playModalTrailer, scrollRow, switchTab */

let library = {
  movies: [],
  tvShows: [],
  movieSeries: [],
  continueWatching: [],
};
let heroCandidates = [];
let heroIndex = 0;
let currentHero = null;
let activeModalItem = null;
let activeTab = 'all';
let libraryGeneration = 0;
const mediaById = new Map();

function escapeHtml(value) {
  const entities = {
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;',
  };
  return String(value ?? '').replace(
    /[&<>"']/g,
    (character) => entities[character]
  );
}

async function loadLibrary() {
  const generation = ++libraryGeneration;
  try {
    const result = await requestJson('/api/library');
    if (generation !== libraryGeneration) return;
    library = result;
    mediaById.clear();
    for (const item of [
      ...library.movies,
      ...library.tvShows,
      ...library.movieSeries.flatMap((series) => series.movies),
    ]) {
      if (!mediaById.has(item.id)) mediaById.set(item.id, item);
      for (const season of item.seasons || []) {
        for (const episode of season.episodes)
          mediaById.set(episode.id, episode);
      }
    }
    renderUI();
  } catch (error) {
    reportError(error);
    if (!mediaById.size)
      document.getElementById('heroOverview').textContent =
        'Unable to load your library. Check the server and try Rescan.';
  }
}

// 3D Tilt Card Parallax
function attachCard3DEffect(cardWrapper) {
  const card = cardWrapper.querySelector('.tv-card');
  if (!card) return;

  cardWrapper.addEventListener('mousemove', (e) => {
    const rect = card.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    const centerX = rect.width / 2;
    const centerY = rect.height / 2;
    const rotateX = ((y - centerY) / centerY) * -8;
    const rotateY = ((x - centerX) / centerX) * 8;

    card.style.transform = `perspective(1000px) rotateX(${rotateX}deg) rotateY(${rotateY}deg) scale3d(1.04, 1.04, 1.04) translateY(-3px)`;

    const glare = card.querySelector('.tv-card-glare');
    if (glare) {
      glare.style.background = `radial-gradient(circle at ${x}px ${y}px, rgba(255,180,60,0.35), transparent 70%)`;
    }
  });

  cardWrapper.addEventListener('mouseleave', () => {
    card.style.transform =
      'perspective(1000px) rotateX(0deg) rotateY(0deg) scale3d(1, 1, 1)';
  });

  cardWrapper.addEventListener('pointerdown', () => {
    card.style.transform = 'perspective(1000px) scale3d(0.97, 0.97, 0.97)';
  });
  cardWrapper.addEventListener('pointerup', () => {
    card.style.transform = 'perspective(1000px) scale3d(1.04, 1.04, 1.04)';
  });
}

// Media Card Creator preserving Natural 2:3 Studio Poster Proportions
function createMediaCard(item, isSeriesFilm = false) {
  const wrapper = document.createElement('div');
  wrapper.className =
    'tv-card-wrapper flex-shrink-0 cursor-pointer select-none';
  wrapper.tabIndex = 0;
  wrapper.__itemData = item;

  const poster = item.posterUrl || `/api/poster/${item.id}`;
  const epCount =
    item.type === 'tv'
      ? (item.seasons || []).reduce(
          (acc, s) => acc + (s.episodes?.length || 0),
          0
        )
      : null;

  wrapper.innerHTML = `
    <div class="tv-card relative w-48 sm:w-56 aspect-[2/3] rounded-2xl overflow-hidden glass-card group border border-white/10 transition-all duration-300 shadow-xl">
      <!-- Exact 2:3 Poster Artwork -->
      <img alt="" class="absolute inset-0 w-full h-full object-cover rounded-2xl transition-transform duration-500 group-hover:scale-105" loading="lazy" />

      <!-- Gradient Ambient Scrim -->
      <div class="absolute inset-0 bg-gradient-to-t from-black/95 via-black/25 to-transparent rounded-2xl"></div>
      <div class="tv-card-glare"></div>

      <!-- Top Status Badges -->
      <div class="absolute top-2.5 right-2.5 flex flex-col items-end gap-1 z-20">
        ${
          isSeriesFilm && item.part
            ? `
          <span class="px-2 py-0.5 rounded-full text-[9px] font-bold bg-orange-500 text-white shadow-md">
            ${escapeHtml(item.part)}
          </span>
        `
            : ''
        }
        ${
          item.type === 'tv'
            ? `
          <span class="px-2 py-0.5 rounded-full text-[9px] font-bold bg-orange-500/30 text-orange-200 border border-orange-500/30 backdrop-blur-md">
            SERIES
          </span>
        `
            : ''
        }
        ${
          item.year
            ? `
          <span class="px-2 py-0.5 rounded-full text-[10px] font-bold bg-black/60 backdrop-blur-md text-white border border-white/10">
            ${escapeHtml(item.year)}
          </span>
        `
            : ''
        }
        <span class="px-2 py-0.5 rounded-full text-[9px] font-semibold bg-orange-500/25 text-orange-300 border border-orange-500/30 backdrop-blur-md">
          ${escapeHtml(item.views || 0)} views
        </span>
      </div>

      <!-- Bottom Info Overlay -->
      <div class="absolute bottom-0 inset-x-0 p-3.5 space-y-1.5 z-20">
        <div class="text-xs sm:text-sm font-bold text-white truncate drop-shadow">${escapeHtml(item.title)}</div>
        <div class="flex items-center gap-2 text-[10px] text-white/60">
          ${item.rating ? `<span class="text-amber-400 font-semibold">★ ${escapeHtml(item.rating)}</span><span>•</span>` : ''}
          <span class="truncate">${escapeHtml(epCount ? `${epCount} Episodes` : (item.genres && item.genres[0]) || 'Cinema')}</span>
        </div>
      </div>
    </div>
  `;

  const image = wrapper.querySelector('img');
  image.src = artworkUrl(poster, `/api/poster/${item.id}`);
  image.alt = item.title;
  wrapper.setAttribute('role', 'button');
  wrapper.onclick = () => openDetails(item);
  attachCard3DEffect(wrapper);

  // 3x Pop-Out Preview (1s delay) & 80% Theater dwell (5s)
  wrapper.addEventListener('mouseenter', () =>
    showPopoutPreview(wrapper, item)
  );
  wrapper.addEventListener('mouseleave', () => hidePopoutPreview());

  return wrapper;
}

function renderUI() {
  hidePopoutPreview(true);
  renderHero();
  renderUpNext();
  renderMovies();
  renderTvShows();
  renderMovieSeries();
  switchTab(activeTab);
}

// Hero Carousel Previous & Next Cycling
function cycleHero(dir) {
  if (!heroCandidates || heroCandidates.length === 0) return;
  heroIndex = (heroIndex + dir + heroCandidates.length) % heroCandidates.length;
  displayHero(heroCandidates[heroIndex]);
}

function renderHero() {
  const pool = [...(library.movies || []), ...(library.tvShows || [])];

  heroCandidates = pool.filter((m) => m.backdropUrl || m.posterUrl);
  if (heroCandidates.length === 0) heroCandidates = pool;

  if (heroCandidates.length === 0) {
    document.getElementById('heroTitle').textContent = 'Welcome to Orange TV';
    document.getElementById('heroOverview').textContent =
      'Your library is ready. Place movies or TV series into your folders and start streaming.';
    currentHero = null;
    document.getElementById('heroBackdrop').style.backgroundImage = '';
    return;
  }

  if (heroIndex >= heroCandidates.length) heroIndex = 0;
  displayHero(heroCandidates[heroIndex]);
}

function displayHero(hero) {
  currentHero = hero;
  if (!currentHero) return;

  document.getElementById('heroTitle').textContent = currentHero.title;
  document.getElementById('heroOverview').textContent =
    currentHero.overview ||
    (currentHero.type === 'tv'
      ? 'Stream full seasons directly from your local library.'
      : 'High-definition streaming with Orange TV.');
  document.getElementById('heroYear').textContent = currentHero.year || '2026';

  const ratingEl = document.getElementById('heroRating');
  if (currentHero.rating) {
    ratingEl.textContent = `★ ${currentHero.rating}`;
    ratingEl.style.display = 'inline';
  } else {
    ratingEl.style.display = 'none';
  }

  const genreEl = document.getElementById('heroGenre');
  const g =
    (currentHero.genres && currentHero.genres[0]) ||
    (currentHero.type === 'tv' ? 'Series' : 'Cinema');
  genreEl.textContent = g;

  const viewsCountEl = document.getElementById('heroViewsCount');
  viewsCountEl.textContent = `${currentHero.views || 0} views`;

  // Always anchor hero backdrop to center top so upper part is never cut off
  const bgUrl =
    currentHero.backdropUrl ||
    currentHero.posterUrl ||
    `/api/backdrop/${currentHero.id}`;
  const heroEl = document.getElementById('heroBackdrop');
  setArtworkBackground(heroEl, bgUrl, `/api/poster/${currentHero.id}`);
  heroEl.style.backgroundPosition = 'center top';
  heroEl.style.backgroundSize = 'cover';
  heroEl.style.backgroundRepeat = 'no-repeat';
}

function renderUpNext() {
  const rowSection = document.getElementById('rowUpNext');
  const container = document.getElementById('upNextScroll');
  container.innerHTML = '';

  const continueList = (library.continueWatching || []).filter((item) =>
    mediaById.has(item.id)
  );
  if (continueList.length === 0) {
    rowSection.style.display = 'none';
    return;
  }

  rowSection.style.display = 'block';
  continueList.forEach((item) => {
    const card = document.createElement('div');
    card.className = 'tv-card-wrapper flex-shrink-0 cursor-pointer';
    card.tabIndex = 0;

    const progressPercent = Math.max(
      0,
      Math.min(100, Number(item.percent) || 0)
    );
    const bgImg =
      item.backdropUrl || item.posterUrl || `/api/backdrop/${item.id}`;
    const subLabel = item.showTitle
      ? `S${item.season}:E${item.episode}`
      : `${Math.max(1, Math.ceil(((item.duration || 0) - (item.currentTime || 0)) / 60))}m left`;

    card.innerHTML = `
      <div class="tv-card relative w-64 sm:w-80 h-36 sm:h-44 rounded-2xl overflow-hidden glass-card group border border-white/10 transition-all duration-300">
        <div class="absolute inset-0 bg-cover bg-center transition-transform duration-500 group-hover:scale-105" data-artwork></div>
        <div class="absolute inset-0 bg-gradient-to-t from-black/90 via-black/40 to-black/20"></div>
        <div class="tv-card-glare"></div>

        <div class="absolute top-2.5 right-2.5 px-2 py-0.5 rounded-full text-[9px] font-semibold bg-orange-500/30 text-orange-200 border border-orange-500/30 backdrop-blur-md">
          Resume
        </div>

        <!-- Center Play Button Overlay -->
        <div class="absolute inset-0 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity">
          <div class="w-12 h-12 rounded-full bg-orange-500 text-white flex items-center justify-center shadow-2xl transform scale-90 group-hover:scale-100 transition-transform">
            <svg class="w-5 h-5 fill-current ml-0.5" viewBox="0 0 24 24"><polygon points="5 3 19 12 5 21 5 3"></polygon></svg>
          </div>
        </div>

        <!-- Bottom Progress & Subtitle -->
        <div class="absolute bottom-0 left-0 right-0 p-3 space-y-1.5 z-10">
          <div class="flex items-center justify-between text-xs font-semibold text-white">
            <span class="truncate">${escapeHtml(item.title)}</span>
            <span class="text-orange-400 font-mono text-[11px]">${escapeHtml(subLabel)}</span>
          </div>
          <div class="orange-progress">
            <div class="orange-progress-fill" style="width: ${progressPercent}%;"></div>
          </div>
        </div>
      </div>
    `;

    card.__itemData = item;
    card.setAttribute('role', 'button');
    setArtworkBackground(
      card.querySelector('[data-artwork]'),
      bgImg,
      `/api/poster/${item.id}`
    );
    card.onclick = () => playDirectMedia(item.id);
    container.appendChild(card);
  });
}

function renderMovies() {
  const query = document
    .getElementById('searchInput')
    .value.toLowerCase()
    .trim();
  const container = document.getElementById('moviesScroll');
  container.innerHTML = '';

  (library.movies || [])
    .filter((item) => item.title.toLowerCase().includes(query))
    .forEach((item) => {
      container.appendChild(createMediaCard(item));
    });
}

function renderTvShows() {
  const query = document
    .getElementById('searchInput')
    .value.toLowerCase()
    .trim();
  const container = document.getElementById('tvScroll');
  container.innerHTML = '';

  (library.tvShows || [])
    .filter((item) => item.title.toLowerCase().includes(query))
    .forEach((item) => {
      container.appendChild(createMediaCard(item));
    });
}

// Render Movie Series with Separate Headings per Franchise
function renderMovieSeries() {
  const container = document.getElementById('seriesContainer');
  container.innerHTML = '';

  const seriesList = library.movieSeries || [];
  if (seriesList.length === 0) {
    document.getElementById('sectionMovieSeries').style.display = 'none';
    return;
  }
  document.getElementById('sectionMovieSeries').style.display = 'block';

  seriesList.forEach((series, idx) => {
    const seriesBlock = document.createElement('div');
    seriesBlock.className = 'space-y-3';

    const rowId = `seriesScroll_${idx}`;
    seriesBlock.innerHTML = `
      <div class="flex items-center justify-between border-l-2 border-orange-500 pl-3">
        <div>
          <h3 class="text-lg font-bold tracking-tight text-white flex items-center gap-2">
            ${escapeHtml(series.title)}
            <span class="text-xs font-normal text-white/50">${escapeHtml(series.tagline || '')}</span>
          </h3>
          <p class="text-xs text-white/60 line-clamp-1 max-w-xl">${escapeHtml(series.overview || '')}</p>
        </div>
        <div class="flex items-center gap-1">
          <button onclick="scrollRow('${rowId}', -1)" tabindex="0" class="glass-btn p-1.5 rounded-full text-white/70 hover:text-white">
            <svg class="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="15 18 9 12 15 6"></polyline></svg>
          </button>
          <button onclick="scrollRow('${rowId}', 1)" tabindex="0" class="glass-btn p-1.5 rounded-full text-white/70 hover:text-white">
            <svg class="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="9 18 15 12 9 6"></polyline></svg>
          </button>
        </div>
      </div>

      <div id="${rowId}" class="flex gap-6 sm:gap-7 overflow-x-auto no-scrollbar scroll-smooth py-4 px-1">
      </div>
    `;

    const rowContainer = seriesBlock.querySelector(`#${rowId}`);
    (series.movies || []).forEach((m) => {
      rowContainer.appendChild(createMediaCard(m, true));
    });

    container.appendChild(seriesBlock);
  });
}

function playDirectMedia(id) {
  const item = mediaById.get(id);
  if (!item) return;
  const playable = item.type === 'tv' ? item.seasons?.[0]?.episodes?.[0] : item;
  if (playable) launchStream(playable);
}

function scrollRow(id, dir) {
  const el = document.getElementById(id);
  if (!el) return;
  const amount = el.clientWidth * 0.75;
  el.scrollBy({ left: dir * amount, behavior: 'smooth' });
}

function switchTab(tab) {
  document.querySelectorAll('.nav-tab').forEach((b) => {
    b.className =
      'nav-tab px-3.5 py-1.5 rounded-full text-xs font-medium text-white/70 hover:text-white hover:bg-white/10 transition-all';
  });
  const activeBtn = document.getElementById(`nav-${tab}`);
  if (activeBtn) {
    activeBtn.className =
      'nav-tab active px-3.5 py-1.5 rounded-full text-xs font-semibold text-white bg-gradient-to-r from-orange-500 to-amber-500 shadow-md shadow-orange-500/25 transition-all';
  }

  const upNext = document.getElementById('rowUpNext');
  const movies = document.getElementById('rowMovies');
  const tv = document.getElementById('rowTv');
  const series = document.getElementById('sectionMovieSeries');

  activeTab = tab;
  if (upNext)
    upNext.style.display =
      tab === 'all' &&
      (library.continueWatching || []).some((item) => mediaById.has(item.id))
        ? 'block'
        : 'none';
  if (movies)
    movies.style.display = ['all', 'movies'].includes(tab) ? 'block' : 'none';
  if (tv) tv.style.display = ['all', 'tv'].includes(tab) ? 'block' : 'none';
  if (series)
    series.style.display =
      ['all', 'series'].includes(tab) && library.movieSeries?.length
        ? 'block'
        : 'none';
}

function handleSearch() {
  hidePopoutPreview(true);
  renderMovies();
  renderTvShows();
}

// Modal Details
function openDetails(item) {
  hidePopoutPreview(true);
  activeModalItem = item;
  document.getElementById('modalTitle').textContent = item.title;
  document.getElementById('modalOverview').textContent =
    item.overview || 'Stream this title in high-definition on Orange TV.';
  document.getElementById('modalRating').textContent = item.rating
    ? `★ ${item.rating}`
    : '★ 8.8';
  document.getElementById('modalTypeBadge').textContent =
    item.type === 'tv' ? 'TV SHOW' : item.part ? 'SERIES FILM' : 'MOVIE';
  document.getElementById('modalViewsCount').textContent =
    `${item.views || 0} Views`;

  const bg = item.backdropUrl || item.posterUrl || `/api/poster/${item.id}`;
  setArtworkBackground(
    document.getElementById('modalBackdrop'),
    bg,
    `/api/poster/${item.id}`
  );

  const epSec = document.getElementById('modalEpisodesSection');
  const epList = document.getElementById('modalEpisodesList');
  if (item.type === 'tv' && item.seasons && item.seasons.length > 0) {
    epSec.classList.remove('hidden');
    epList.innerHTML = '';
    item.seasons.forEach((s) => {
      (s.episodes || []).forEach((ep) => {
        const row = document.createElement('div');
        row.tabIndex = 0;
        row.setAttribute('role', 'button');
        row.className =
          'flex items-center justify-between p-2.5 rounded-xl hover:bg-white/10 transition-colors cursor-pointer text-xs';
        row.onclick = () => {
          closeDetails();
          launchStream(ep);
        };
        row.innerHTML = `
          <div class="flex items-center gap-3">
            <span class="w-6 h-6 rounded-full bg-orange-500/20 text-orange-400 font-bold flex items-center justify-center text-[10px]">${escapeHtml(ep.episode)}</span>
            <div>
              <div class="font-medium text-white">${escapeHtml(ep.title)}</div>
              <div class="text-[10px] text-white/50">Season ${escapeHtml(ep.season || 1)} • Episode ${escapeHtml(ep.episode)}</div>
            </div>
          </div>
          <span class="orange-primary-btn p-1.5 rounded-full">
            <svg class="w-3.5 h-3.5 fill-current ml-0.5" viewBox="0 0 24 24"><polygon points="5 3 19 12 5 21 5 3"></polygon></svg>
          </span>
        `;
        epList.appendChild(row);
      });
    });
  } else {
    epSec.classList.add('hidden');
  }

  const modal = document.getElementById('detailModal');
  const box = document.getElementById('modalBox');
  setOverlayVisible(modal, true);
  box.classList.remove('scale-95');
  box.classList.add('scale-100');
  focusOverlay(modal);
}

function closeDetails() {
  const modal = document.getElementById('detailModal');
  const box = document.getElementById('modalBox');
  setOverlayVisible(modal, false);
  box.classList.add('scale-95');
  box.classList.remove('scale-100');
  restoreFocus(modal);
}

function playModalItem() {
  if (!activeModalItem) return;
  closeDetails();
  playDirectMedia(activeModalItem.id);
}

function playModalTrailer() {
  if (!activeModalItem) return;
  closeDetails();
  launchTrailer(activeModalItem);
}

function playCurrentHero() {
  if (currentHero) playDirectMedia(currentHero.id);
}

function playCurrentHeroTrailer() {
  if (!currentHero) return;
  launchTrailer(currentHero);
}

function openHeroDetails() {
  if (currentHero) openDetails(currentHero);
}
