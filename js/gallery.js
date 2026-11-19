// Lógica de la galería en vivo: sincroniza con el listado de media-service
// (nuestro propio servidor, sin pasar por Drive/n8n). Usada por galeria.html.

const GALLERY_LIST_URL = 'https://bodagloriayjose.ivangonzalez.cloud/list';
const GALLERY_POLL_INTERVAL_MS = 20000;
const GALLERY_SKELETON_COUNT = 6;

function initGallery({ photoGridId, videoGridId, photoEmptyId, videoEmptyId, errorId, photoCountId, videoCountId }) {
  const photoGrid = document.getElementById(photoGridId);
  const videoGrid = document.getElementById(videoGridId);
  const photoEmpty = document.getElementById(photoEmptyId);
  const videoEmpty = document.getElementById(videoEmptyId);
  const errorState = document.getElementById(errorId);
  const photoCount = document.getElementById(photoCountId);
  const videoCount = document.getElementById(videoCountId);
  if (!photoGrid || !videoGrid) return;

  const renderedIds = new Set();
  let pollTimer = null;
  let firstLoadDone = false;

  // media-service genera cada `id` como {timestamp}_{hex} — lo usamos para
  // ordenar sin depender de metadatos adicionales.
  function idTimestamp(id) {
    const match = /^(\d+)_/.exec(id || '');
    return match ? parseInt(match[1], 10) : 0;
  }

  function renderSkeletons(grid, count, extraClass) {
    for (let i = 0; i < count; i++) {
      const tile = document.createElement('div');
      tile.className = extraClass ? `skeleton-tile ${extraClass}` : 'skeleton-tile';
      grid.appendChild(tile);
    }
  }

  function clearSkeletons(grid) {
    grid.querySelectorAll('.skeleton-tile').forEach(el => el.remove());
  }

  function createPhotoTile(item) {
    const tile = document.createElement('div');
    tile.className = 'gallery-tile';
    const img = document.createElement('img');
    img.src = item.gridUrl;
    img.alt = item.name || '';
    img.loading = 'lazy';
    img.addEventListener('click', () => openLightbox(item.url));
    tile.appendChild(img);
    return tile;
  }

  function createVideoTile(item) {
    const tile = document.createElement('div');
    tile.className = 'gallery-tile video-tile';

    const video = document.createElement('video');
    video.src = item.url;
    video.poster = item.posterUrl;
    video.controls = true;
    video.preload = 'metadata';
    tile.appendChild(video);

    return tile;
  }

  function openLightbox(url) {
    const overlay = document.createElement('div');
    overlay.className = 'gallery-lightbox';

    const img = document.createElement('img');
    img.src = url;

    const close = document.createElement('button');
    close.className = 'lightbox-close';
    close.type = 'button';
    close.setAttribute('aria-label', 'Cerrar');
    close.textContent = '✕';

    function closeLightbox() {
      overlay.classList.remove('is-open');
      document.removeEventListener('keydown', onKeydown);
      overlay.addEventListener('transitionend', () => overlay.remove(), { once: true });
    }
    function onKeydown(e) {
      if (e.key === 'Escape') closeLightbox();
    }

    overlay.appendChild(img);
    overlay.appendChild(close);
    overlay.addEventListener('click', (e) => { if (e.target === overlay) closeLightbox(); });
    close.addEventListener('click', closeLightbox);
    document.addEventListener('keydown', onKeydown);
    document.body.appendChild(overlay);
    requestAnimationFrame(() => overlay.classList.add('is-open'));
  }

  function render(items) {
    const validItems = items.filter(item => item.mimeType && (item.mimeType.startsWith('image/') || item.mimeType.startsWith('video/')));
    const photos = validItems.filter(item => item.mimeType.startsWith('image/')).sort((a, b) => idTimestamp(b.id) - idTimestamp(a.id));
    const videos = validItems.filter(item => item.mimeType.startsWith('video/')).sort((a, b) => idTimestamp(b.id) - idTimestamp(a.id));

    if (!firstLoadDone) {
      clearSkeletons(photoGrid);
      clearSkeletons(videoGrid);
      firstLoadDone = true;
    }

    if (photoEmpty) photoEmpty.hidden = photos.length > 0;
    if (videoEmpty) videoEmpty.hidden = videos.length > 0;
    if (photoCount) photoCount.textContent = photos.length;
    if (videoCount) videoCount.textContent = videos.length;

    photos.filter(item => !renderedIds.has(item.id)).reverse().forEach(item => {
      renderedIds.add(item.id);
      photoGrid.insertBefore(createPhotoTile(item), photoGrid.firstChild);
    });
    videos.filter(item => !renderedIds.has(item.id)).reverse().forEach(item => {
      renderedIds.add(item.id);
      videoGrid.insertBefore(createVideoTile(item), videoGrid.firstChild);
    });
  }

  async function fetchAndRender() {
    try {
      const res = await fetch(GALLERY_LIST_URL, { signal: AbortSignal.timeout(15000) });
      if (!res.ok) throw new Error('HTTP ' + res.status);
      const items = await res.json();
      render(Array.isArray(items) ? items : []);
      if (errorState) errorState.hidden = true;
    } catch (err) {
      if (errorState) errorState.hidden = false;
    }
  }

  function startPolling() {
    if (pollTimer) return;
    fetchAndRender();
    pollTimer = setInterval(fetchAndRender, GALLERY_POLL_INTERVAL_MS);
  }

  function stopPolling() {
    if (pollTimer) {
      clearInterval(pollTimer);
      pollTimer = null;
    }
  }

  document.addEventListener('visibilitychange', () => {
    if (document.hidden) stopPolling();
    else startPolling();
  });

  renderSkeletons(photoGrid, GALLERY_SKELETON_COUNT);
  renderSkeletons(videoGrid, Math.round(GALLERY_SKELETON_COUNT / 2), 'video-skeleton');
  startPolling();
}
