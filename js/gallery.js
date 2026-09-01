// Lógica de la galería en vivo: sincroniza con la carpeta de Drive vía el
// webhook de listado de n8n. Usada por galeria.html.

const GALLERY_WEBHOOK_URL = 'https://n8n.ivangonzalez.cloud/webhook/boda-fotos-galeria';
const GALLERY_POLL_INTERVAL_MS = 20000;

function initGallery({ gridId, emptyId, errorId }) {
  const grid = document.getElementById(gridId);
  const emptyState = document.getElementById(emptyId);
  const errorState = document.getElementById(errorId);
  if (!grid) return;

  const renderedIds = new Set();
  let pollTimer = null;

  // Los archivos se suben con el nombre prefijado por su timestamp
  // ({{$now.toMillis()}}_nombre) — lo usamos para ordenar sin depender de
  // metadatos adicionales de Drive.
  function uploadTimestamp(name) {
    const match = /^(\d+)_/.exec(name || '');
    return match ? parseInt(match[1], 10) : 0;
  }

  function createTile(item) {
    const tile = document.createElement('div');
    tile.className = 'gallery-tile';

    if (item.mimeType.startsWith('video/')) {
      const iframe = document.createElement('iframe');
      iframe.src = `https://drive.google.com/file/d/${item.id}/preview`;
      iframe.allow = 'autoplay';
      iframe.loading = 'lazy';
      tile.appendChild(iframe);

      const fallback = document.createElement('a');
      fallback.className = 'gallery-fallback-link';
      fallback.href = `https://drive.google.com/file/d/${item.id}/view`;
      fallback.target = '_blank';
      fallback.rel = 'noopener';
      fallback.textContent = 'Abrir en Drive';
      tile.appendChild(fallback);
    } else {
      const img = document.createElement('img');
      img.src = `https://drive.google.com/thumbnail?id=${item.id}&sz=w800`;
      img.alt = item.name || '';
      img.loading = 'lazy';
      // El endpoint de miniaturas aplica rate-limiting agresivo a peticiones
      // anónimas repetidas; si falla, se cae a la vista completa del archivo.
      img.addEventListener('error', () => {
        img.src = `https://drive.google.com/uc?export=view&id=${item.id}`;
      }, { once: true });
      img.addEventListener('click', () => openLightbox(item.id));
      tile.appendChild(img);
    }
    return tile;
  }

  function openLightbox(id) {
    const overlay = document.createElement('div');
    overlay.className = 'gallery-lightbox';
    const img = document.createElement('img');
    img.src = `https://drive.google.com/thumbnail?id=${id}&sz=w1600`;
    img.addEventListener('error', () => {
      img.src = `https://drive.google.com/uc?export=view&id=${id}`;
    }, { once: true });
    overlay.appendChild(img);
    overlay.addEventListener('click', () => overlay.remove());
    document.body.appendChild(overlay);
  }

  function render(items) {
    const validItems = items
      .filter(item => item.mimeType && (item.mimeType.startsWith('image/') || item.mimeType.startsWith('video/')))
      .sort((a, b) => uploadTimestamp(b.name) - uploadTimestamp(a.name));

    if (emptyState) emptyState.hidden = validItems.length > 0;

    const newItems = validItems.filter(item => !renderedIds.has(item.id));
    newItems.reverse().forEach(item => {
      renderedIds.add(item.id);
      grid.insertBefore(createTile(item), grid.firstChild);
    });
  }

  async function fetchAndRender() {
    try {
      const res = await fetch(GALLERY_WEBHOOK_URL, { signal: AbortSignal.timeout(15000) });
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

  startPolling();
}
