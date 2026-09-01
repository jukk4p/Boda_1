# Galería de fotos en vivo — Plan de implementación

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Añadir a ambas invitaciones (Gloria&José y Daniel&Irene) una página `galeria.html` que muestra, casi en tiempo real, las fotos y vídeos que los invitados van subiendo a la carpeta de Google Drive de cada boda.

**Architecture:** Un nuevo workflow n8n de solo lectura por boda (Webhook GET → Google Drive "listar carpeta" → Respond JSON) expone el contenido de la carpeta de Drive. Cada `galeria.html` hace `fetch()` a ese webhook al cargar y cada ~20s (polling), compara IDs ya pintados contra los nuevos, y antepone solo los tiles nuevos sin recargar la página. Fotos vía `drive.google.com/thumbnail`, vídeos embebidos vía `drive.google.com/file/d/.../preview`. Sin backend propio, sin claves de API de Google en el cliente — mismo patrón que el backend de subida ya existente.

**Tech Stack:** HTML/CSS/JS vanilla (sin frameworks ni dependencias externas), n8n (self-hosted en Coolify) para los endpoints, Google Drive como almacenamiento.

**Spec:** `docs/superpowers/specs/2026-09-01-galeria-fotos-live-design.md`

## Global Constraints

- Polling cada ~20 segundos (`GALLERY_POLL_INTERVAL_MS = 20000`), no push instantáneo.
- Sin moderación: todo lo subido aparece automáticamente, sin cola de aprobación.
- Vídeos reproducibles embebidos directamente en la cuadrícula (iframe `/preview`), no solo miniatura enlazando a Drive.
- Un recurso dedicado por boda (workflow n8n + página), nunca compartido entre las dos bodas — mismo criterio ya usado para los webhooks de subida.
- Sin backend propio, sin frameworks ni librerías JS externas (ni CDN) — JS vanilla autocontenido, igual que `js/upload.js` y `js/qrcode.js`.
- Copy de UI en español, mismo tono que el resto de cada sitio.
- Cada sitio vive en su propio repositorio git independiente: `invitacion-editorial` (Gloria&José, rama `main`) e `invitación-dani-irene` (Daniel&Irene, rama `master`) — los commits de cada tarea van al repo correspondiente, nunca mezclados.

---

### Task 1: Verificar si los archivos subidos ya son visibles públicamente sin login

**Contexto:** Antes de decidir si hace falta un nodo extra en los workflows de subida, hay que comprobar si Drive ya expone los archivos subidos (por herencia del permiso de la carpeta) sin necesitar compartirlos explícitamente archivo por archivo.

**Files:** Ninguno (tarea de verificación, no toca el repo).

**Interfaces:**
- Produces: decisión booleana `necesitaNodoShare` para Gloria&José y para Daniel&Irene, que determina si la Task 2 se ejecuta.

- [x] **Paso 1: Subir un archivo de prueba a la boda de Gloria&José vía el webhook de producción**

```bash
curl -s -X POST "https://n8n.ivangonzalez.cloud/webhook/boda-fotos" \
  -F "data=@C:/Users/jukkaP/Desktop/skill/Nueva carpeta/invitacion-editorial/img/favicon.png;type=image/png"
```

Expected: respuesta HTTP 200 (el body no importa para esta prueba).

- [x] **Paso 2: Obtener el ID de Drive del archivo recién creado**

En el navegador, abrir `https://n8n.ivangonzalez.cloud/workflow/` → workflow **"Boda Gloria & José - Subida de fotos a Drive"** → pestaña **Executions** → última ejecución (debe ser la de hace unos segundos) → click en el nodo **Google Drive** → en el panel de output, copiar el campo `id` del archivo creado.

- [x] **Paso 3: Comprobar si el archivo es visible sin sesión de Google**

```bash
curl -s -o /dev/null -w "%{http_code}\n" "https://drive.google.com/thumbnail?id=<ID_COPIADO_EN_PASO_2>&sz=w800"
```

- Si devuelve `200` → el archivo ya es público, `necesitaNodoShare_GloriaJose = false`.
- Si devuelve cualquier otro código (`302`, `401`, `403`...) → `necesitaNodoShare_GloriaJose = true`.

- [x] **Paso 4: Repetir los pasos 1-3 para Daniel&Irene**

```bash
curl -s -X POST "https://n8n.ivangonzalez.cloud/webhook/boda-daniel-irene-fotos" \
  -F "data=@C:/Users/jukkaP/Desktop/skill/Nueva carpeta/invitación-dani-irene/img/favicon.png;type=image/png"
```

Workflow a revisar en Executions: **"Boda Daniel & Irene - Subida de fotos a Drive"**.

```bash
curl -s -o /dev/null -w "%{http_code}\n" "https://drive.google.com/thumbnail?id=<ID_COPIADO>&sz=w800"
```

- `200` → `necesitaNodoShare_DanielIrene = false`.
- Otro código → `necesitaNodoShare_DanielIrene = true`.

- [x] **Paso 5: Registrar el resultado**

Anotar los dos booleanos obtenidos — determinan si la Task 2 se ejecuta para ninguna, una o ambas bodas.

---

### Task 2: Añadir nodo de permiso público a los workflows de subida (solo si Task 1 lo determinó necesario)

**Skip this task entirely for una boda si su resultado en Task 1 fue `false`.** Si ambas dieron `false`, saltar directamente a Task 3.

**Resultado:** Task 1 dio `necesitaNodoShare = false` para ambas bodas (los archivos ya son públicos por herencia del permiso de la carpeta). **Esta tarea se saltó por completo, para ninguna de las dos bodas.**

**Files:** Ninguno (cambios viven en n8n, no en el repo).

**Interfaces:**
- Consumes: resultado de Task 1 (`necesitaNodoShare_*`).
- Produces: archivos subidos a partir de ahora quedan visibles con `role: reader, type: anyone` sin necesitar sesión de Google.

- [ ] (Omitido — no aplicaba) **Paso 1 (si aplica a Gloria&José): añadir nodo Share**

En `https://n8n.ivangonzalez.cloud`, abrir el workflow **"Boda Gloria & José - Subida de fotos a Drive"**. Entre el nodo **Google Drive → Upload** y **Respond OK**, insertar un nuevo nodo Google Drive (mismas credenciales OAuth2 ya conectadas) configurado para conceder permiso de lectura pública sobre el archivo recién subido:
- Resource: `File`
- Operation: la operación de permisos/compartir disponible en esa versión del nodo (`Share` o equivalente — confirmar el nombre exacto en la UI en vivo).
- Permission Type: `anyone`
- Role: `reader`
- File ID: expresión que referencia el `id` del nodo Upload anterior (ej. `{{$node["Google Drive"].json["id"]}}`, ajustar el nombre del nodo si difiere).

Conectar la salida de este nodo hacia **Respond OK** (en el lugar donde antes conectaba directamente Upload → Respond OK).

- [ ] (Omitido — no aplicaba) **Paso 2 (si aplica a Gloria&José): publicar y verificar**

Publicar el workflow (botón **Publish**, igual que se hizo al crear el workflow de Daniel&Irene). Repetir Paso 1 y 3 de Task 1 (subir un archivo de prueba nuevo, comprobar `curl -o /dev/null -w "%{http_code}"` sobre su thumbnail) y confirmar que ahora devuelve `200`.

- [ ] (Omitido — no aplicaba) **Paso 3 (si aplica a Daniel&Irene): repetir Pasos 1-2 sobre el workflow "Boda Daniel & Irene - Subida de fotos a Drive"**

Misma configuración de nodo, mismas comprobaciones, aplicadas a ese workflow.

---

### Task 3: Workflow n8n "Listar fotos" — Gloria & José

**Files:** Ninguno (vive en n8n).

**Interfaces:**
- Consumes: Folder ID `1Pl4S9s1uf0jDqV5Vkgrsp_PAYNpMou3l` (mismo que usa el workflow de subida existente), credencial OAuth2 de Drive ya conectada en n8n.
- Produces: `GET https://n8n.ivangonzalez.cloud/webhook/boda-fotos-galeria` → JSON `[{ "id": string, "name": string, "mimeType": string, "createdTime": string }, ...]` ordenado por `createdTime` descendente. Esta URL la consume la Task 5.

- [x] **Paso 1: Crear el workflow**

En `https://n8n.ivangonzalez.cloud/home/workflows`, click **Create workflow**. Renombrar a **"Boda Gloria & José - Listado de fotos"**.

- [x] **Paso 2: Nodo Webhook**

Añadir nodo **Webhook**:
- HTTP Method: `GET`
- Path: `boda-fotos-galeria`
- Authentication: `None`
- Respond: `Using 'Respond to Webhook' Node`

- [x] **Paso 3: Nodo Google Drive (listado)**

Añadir nodo **Google Drive** conectado a la salida del Webhook, usando la misma credencial OAuth2 "Google Drive account" ya conectada en la instancia:
- Resource: `File`
- Operation: `Search` (o la operación de listado equivalente disponible en esa versión del nodo)
- Filtro por carpeta: `1Pl4S9s1uf0jDqV5Vkgrsp_PAYNpMou3l` (mismo Folder ID que el workflow de subida)
- Excluir papelera (`trashed = false`), si el nodo lo permite como opción o hay que añadirlo a la query.
- Return All: activado.
- Order By: `createdTime desc` si el nodo lo expone; si no, se puede ordenar en el propio n8n con un nodo **Sort** adicional por `createdTime` descendente antes de responder.
- Campos a incluir en el output: `id, name, mimeType, createdTime` (limitar campos si el nodo lo permite, o dejar el output completo — el frontend solo lee esos cuatro).

- [x] **Paso 4: Nodo Respond to Webhook**

Conectar tras el nodo Google Drive:
- Respond With: `JSON`
- Response Body: expresión que devuelve el array de items tal cual (ej. `{{$json}}` si el nodo anterior ya emite un item por archivo — n8n serializa automáticamente todos los items de entrada como array JSON al usar "All Incoming Items").

- [x] **Paso 5: Publicar y verificar**

Publicar el workflow. Verificar:

```bash
curl -s "https://n8n.ivangonzalez.cloud/webhook/boda-fotos-galeria"
```

Expected: un array JSON (puede estar vacío `[]`, o con el archivo de prueba subido en Task 1/2) donde cada elemento tiene `id`, `name`, `mimeType`, `createdTime`.

---

### Task 4: Workflow n8n "Listar fotos" — Daniel & Irene

**Files:** Ninguno (vive en n8n).

**Interfaces:**
- Consumes: Folder ID `1U4DQ-R31V3xS9I75ogKoojuWSQFUmg-g`, credencial OAuth2 de Drive ya conectada.
- Produces: `GET https://n8n.ivangonzalez.cloud/webhook/boda-daniel-irene-galeria` → mismo formato JSON que Task 3. Esta URL la consume la Task 6.

- [x] **Paso 1: Crear el workflow**

Click **Create workflow**. Renombrar a **"Boda Daniel & Irene - Listado de fotos"**.

- [x] **Paso 2: Nodo Webhook**

Igual que Task 3 Paso 2, con:
- Path: `boda-daniel-irene-galeria`

- [x] **Paso 3: Nodo Google Drive (listado)**

Igual que Task 3 Paso 3, con Folder ID `1U4DQ-R31V3xS9I75ogKoojuWSQFUmg-g`.

- [x] **Paso 4: Nodo Respond to Webhook**

Igual que Task 3 Paso 4.

- [x] **Paso 5: Publicar y verificar**

```bash
curl -s "https://n8n.ivangonzalez.cloud/webhook/boda-daniel-irene-galeria"
```

Expected: array JSON con `id`, `name`, `mimeType`, `createdTime` por elemento.

---

### Task 5: Galería frontend — Gloria & José

**Files:**
- Create: `Nueva carpeta/invitacion-editorial/js/gallery.js`
- Create: `Nueva carpeta/invitacion-editorial/galeria.html`
- Modify: `Nueva carpeta/invitacion-editorial/index.html:1227-1232` (añadir enlace "Ver Galería")
- Modify: `Nueva carpeta/invitacion-editorial/index.html:1651-1662` (bloqueo por fecha del enlace)

**Interfaces:**
- Consumes: `GALLERY_WEBHOOK_URL = 'https://n8n.ivangonzalez.cloud/webhook/boda-fotos-galeria'` (producida por Task 3).
- Produces: `initGallery({ gridId, emptyId, errorId })` — función global definida en `js/gallery.js`, usada solo por `galeria.html` de este sitio.

- [x] **Paso 1: Crear `js/gallery.js`**

```javascript
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
    overlay.appendChild(img);
    overlay.addEventListener('click', () => overlay.remove());
    document.body.appendChild(overlay);
  }

  function render(items) {
    const validItems = items.filter(item =>
      item.mimeType && (item.mimeType.startsWith('image/') || item.mimeType.startsWith('video/'))
    );

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
```

- [x] **Paso 2: Crear `galeria.html`**

```html
<!DOCTYPE html>
<html lang="es">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<meta name="description" content="Galería de fotos y vídeos de la boda de Gloria y José">
<link rel="icon" type="image/png" href="img/favicon.png">
<title>Galería · Boda Gloria y José</title>
<link href="https://fonts.googleapis.com/css2?family=Cinzel:wght@500;600&family=Montserrat:wght@400;500;600&display=swap" rel="stylesheet">
<style>
  :root {
    --emerald: #1a382b;
    --emerald-dark: #12281e;
    --gold: #c9a063;
    --gold-light: #e2c290;
    --gold-dark: #9e773b;
    --bg-cream: #fbf9f4;
    --dark-text: #231f1a;
    --muted-text: #7a7267;
    --border-gold: rgba(201, 160, 99, 0.35);
  }
  *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
  body {
    font-family: 'Montserrat', sans-serif;
    background: #ebe6da;
    color: var(--dark-text);
    min-height: 100vh;
    padding: 2rem 1.2rem 3rem;
  }
  .header { max-width: 720px; margin: 0 auto 1.8rem; text-align: center; }
  h1 {
    font-family: 'Cinzel', serif;
    font-size: 1.5rem;
    color: var(--emerald);
    font-weight: 600;
    letter-spacing: 0.03em;
    margin-bottom: 0.5rem;
  }
  .header p { font-size: 0.85rem; color: var(--muted-text); line-height: 1.6; }
  .back-link {
    display: inline-block;
    margin-top: 1rem;
    font-family: 'Montserrat', sans-serif;
    font-size: 0.72rem;
    letter-spacing: 0.08em;
    color: var(--gold-dark);
    text-decoration: none;
    border-bottom: 1px solid transparent;
    transition: border-color 0.2s ease;
  }
  .back-link:hover { border-color: var(--gold-dark); }
  .lock-card {
    max-width: 420px;
    margin: 2rem auto;
    background: var(--bg-cream);
    border-radius: 20px;
    border: 1px solid var(--border-gold);
    box-shadow: 0 20px 50px rgba(0,0,0,0.15);
    padding: 2.5rem 1.8rem;
    text-align: center;
  }
  .lock-card p { font-size: 0.88rem; color: var(--muted-text); line-height: 1.6; }
  .gallery-grid {
    max-width: 1100px;
    margin: 0 auto;
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(220px, 1fr));
    gap: 0.9rem;
  }
  .gallery-tile {
    position: relative;
    aspect-ratio: 1 / 1;
    border-radius: 12px;
    overflow: hidden;
    background: var(--bg-cream);
    border: 1px solid var(--border-gold);
  }
  .gallery-tile img { width: 100%; height: 100%; object-fit: cover; display: block; cursor: zoom-in; }
  .gallery-tile iframe { width: 100%; height: 100%; border: none; display: block; }
  .gallery-fallback-link {
    position: absolute;
    bottom: 0.4rem; right: 0.4rem;
    background: rgba(26, 56, 43, 0.85);
    color: var(--gold-light);
    font-size: 0.62rem;
    letter-spacing: 0.05em;
    padding: 0.3rem 0.55rem;
    border-radius: 20px;
    text-decoration: none;
  }
  .gallery-empty, .gallery-error {
    max-width: 420px;
    margin: 2rem auto;
    text-align: center;
    font-size: 0.9rem;
    color: var(--muted-text);
    line-height: 1.6;
  }
  .gallery-error { color: var(--gold-dark); }
  .gallery-lightbox {
    position: fixed; inset: 0;
    background: rgba(18, 40, 30, 0.92);
    display: flex; align-items: center; justify-content: center;
    padding: 2rem;
    cursor: zoom-out;
    z-index: 1000;
  }
  .gallery-lightbox img { max-width: 100%; max-height: 100%; border-radius: 8px; box-shadow: 0 20px 60px rgba(0,0,0,0.5); }
</style>
</head>
<body>
  <div class="header">
    <h1>Nuestros Recuerdos</h1>
    <p>Fotos y vídeos que vais compartiendo hoy, en directo.</p>
    <a class="back-link" href="index.html?open=1">← Volver a la invitación</a>
  </div>

  <div class="lock-card" id="lock-card">
    <p>La galería se activará el día de la boda (31 de julio de 2027). ¡Vuelve entonces para ver las fotos y vídeos que vayáis compartiendo!</p>
  </div>

  <div class="gallery-grid" id="gallery-grid" hidden></div>
  <p class="gallery-empty" id="gallery-empty" hidden>Aún no hay fotos… ¡sé el primero en compartir! <a class="back-link" href="index.html?open=1#recuerdos">Subir una foto</a></p>
  <p class="gallery-error" id="gallery-error" hidden>No se pudieron cargar las fotos, reintentando…</p>

  <script src="js/gallery.js"></script>
  <script>
    const galleryActive = Date.now() >= new Date('2027-07-31T00:00:00').getTime();
    document.getElementById('lock-card').hidden = galleryActive;
    document.getElementById('gallery-grid').hidden = !galleryActive;
    if (galleryActive) {
      initGallery({ gridId: 'gallery-grid', emptyId: 'gallery-empty', errorId: 'gallery-error' });
    }
  </script>
</body>
</html>
```

- [x] **Paso 3: Añadir enlace "Ver Galería" en `index.html`**

En `index.html`, reemplazar (líneas 1227-1232):

```html
      <div>
        <button class="btn-gold" id="upload-btn">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6"><path d="M4 8h3l2-3h6l2 3h3v11H4z"/><circle cx="12" cy="13" r="3.2"/></svg> <span id="upload-btn-label">Subir Fotos y Vídeos</span>
        </button>
        <input type="file" id="upload-input" multiple accept="image/*,video/*" style="display:none">
      </div>
```

por:

```html
      <div>
        <button class="btn-gold" id="upload-btn">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6"><path d="M4 8h3l2-3h6l2 3h3v11H4z"/><circle cx="12" cy="13" r="3.2"/></svg> <span id="upload-btn-label">Subir Fotos y Vídeos</span>
        </button>
        <input type="file" id="upload-input" multiple accept="image/*,video/*" style="display:none">
      </div>
      <div style="margin-top:0.8rem;">
        <a class="btn-gold" id="gallery-link" href="galeria.html">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6"><rect x="3" y="4" width="18" height="14" rx="2"/><path d="M3 14l4.5-4.5a2 2 0 0 1 2.8 0L15 14"/><circle cx="9" cy="9" r="1.2"/></svg> Ver Galería
        </a>
      </div>
```

- [x] **Paso 4: Bloquear el enlace por fecha en `index.html`**

Reemplazar (líneas 1651-1662):

```javascript
  // ── SUBIDA DE FOTOS: bloqueada hasta el día de la boda ──
  const uploadActive = Date.now() >= new Date('2027-07-31T00:00:00').getTime();
  (function () {
    const qrWrap = document.getElementById('qr-wrap');
    const btn = document.getElementById('upload-btn');
    const btnLabel = document.getElementById('upload-btn-label');
    if (!uploadActive) {
      if (qrWrap) qrWrap.classList.add('is-locked');
      if (btn) btn.classList.add('is-disabled');
      if (btnLabel) btnLabel.textContent = 'Disponible el día de la boda';
    }
  })();
```

por:

```javascript
  // ── SUBIDA DE FOTOS: bloqueada hasta el día de la boda ──
  const uploadActive = Date.now() >= new Date('2027-07-31T00:00:00').getTime();
  (function () {
    const qrWrap = document.getElementById('qr-wrap');
    const btn = document.getElementById('upload-btn');
    const btnLabel = document.getElementById('upload-btn-label');
    const galleryLink = document.getElementById('gallery-link');
    if (!uploadActive) {
      if (qrWrap) qrWrap.classList.add('is-locked');
      if (btn) btn.classList.add('is-disabled');
      if (btnLabel) btnLabel.textContent = 'Disponible el día de la boda';
      if (galleryLink) galleryLink.classList.add('is-disabled');
    }
  })();
```

- [x] **Paso 5: Verificación manual**

Abrir `galeria.html` en el navegador. Con la fecha real del sistema (antes del 31/07/2027), debe mostrarse la `lock-card` y la cuadrícula debe permanecer `hidden`. Editar temporalmente `galleryActive` a `true` en las DevTools (o cambiar momentáneamente la fecha de comparación en el código) para comprobar: la cuadrícula se muestra, aparecen los tiles del archivo de prueba subido en Task 1/2, el click en una foto abre el lightbox, y el vídeo (si se subió alguno de prueba) se reproduce embebido. Revertir el cambio temporal antes de continuar.

- [x] **Paso 6: Commit**

```bash
cd "C:/Users/jukkaP/Desktop/skill/Nueva carpeta/invitacion-editorial"
git add js/gallery.js galeria.html index.html
git commit -m "Añade galería de fotos en vivo sincronizada con Drive"
```

---

### Task 6: Galería frontend — Daniel & Irene

**Files:**
- Create: `Nueva carpeta/invitación-dani-irene/js/gallery.js`
- Create: `Nueva carpeta/invitación-dani-irene/galeria.html`
- Modify: `Nueva carpeta/invitación-dani-irene/index.html:866-870` (añadir enlace "Ver Galería")
- Modify: `Nueva carpeta/invitación-dani-irene/index.html:1034-1041` (bloqueo por fecha del enlace)

**Interfaces:**
- Consumes: `GALLERY_WEBHOOK_URL = 'https://n8n.ivangonzalez.cloud/webhook/boda-daniel-irene-galeria'` (producida por Task 4).
- Produces: `initGallery({ gridId, emptyId, errorId })` — función global en `js/gallery.js` de este sitio (independiente de la de Gloria&José, mismo repo distinto).

- [x] **Paso 1: Crear `js/gallery.js`**

Idéntico al de Task 5 Paso 1, cambiando solo la primera constante:

```javascript
// Lógica de la galería en vivo: sincroniza con la carpeta de Drive vía el
// webhook de listado de n8n. Usada por galeria.html.

const GALLERY_WEBHOOK_URL = 'https://n8n.ivangonzalez.cloud/webhook/boda-daniel-irene-galeria';
const GALLERY_POLL_INTERVAL_MS = 20000;

function initGallery({ gridId, emptyId, errorId }) {
  const grid = document.getElementById(gridId);
  const emptyState = document.getElementById(emptyId);
  const errorState = document.getElementById(errorId);
  if (!grid) return;

  const renderedIds = new Set();
  let pollTimer = null;

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
    overlay.appendChild(img);
    overlay.addEventListener('click', () => overlay.remove());
    document.body.appendChild(overlay);
  }

  function render(items) {
    const validItems = items.filter(item =>
      item.mimeType && (item.mimeType.startsWith('image/') || item.mimeType.startsWith('video/'))
    );

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
```

- [x] **Paso 2: Crear `galeria.html`**

```html
<!DOCTYPE html>
<html lang="es">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<meta name="description" content="Galería de fotos y vídeos de la boda de Daniel y Irene">
<link rel="icon" type="image/png" href="img/favicon.png">
<title>Galería · Boda Daniel &amp; Irene</title>
<link href="https://fonts.googleapis.com/css2?family=Fraunces:ital,wght@0,300;0,400;0,500;0,600;1,400;1,500&family=Archivo:wght@400;500;600&display=swap" rel="stylesheet">
<style>
  :root {
    --page:       #e8ece9;
    --paper:      #f6f7f5;
    --ink:        #2f4a63;
    --ink-deep:   #1f3347;
    --ink-soft:   #5c7893;
    --gold:       #b4864c;
    --gold-soft:  #d9b98a;
    --gold-text:  #8a6636;
    --charcoal:   #2b2a27;
    --muted:      #6b7570;
    --mist:       #dbe1de;
  }
  *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
  body {
    font-family: 'Archivo', sans-serif;
    background: var(--page);
    color: var(--charcoal);
    min-height: 100vh;
    padding: 2rem 1.2rem 3rem;
    -webkit-font-smoothing: antialiased;
  }
  .header { max-width: 720px; margin: 0 auto 1.8rem; text-align: center; }
  h1 {
    font-family: 'Fraunces', serif;
    font-weight: 500;
    font-size: 1.6rem;
    color: var(--ink-deep);
    letter-spacing: 0.01em;
    margin-bottom: 0.5rem;
  }
  .header p { font-size: 0.85rem; color: var(--muted); line-height: 1.6; }
  .back-link {
    display: inline-block;
    margin-top: 1rem;
    font-family: 'Archivo', sans-serif;
    font-size: 0.72rem;
    letter-spacing: 0.08em;
    color: var(--gold-text);
    text-decoration: none;
    border-bottom: 1px solid transparent;
    transition: border-color 0.2s ease;
  }
  .back-link:hover { border-color: var(--gold-text); }
  .lock-card {
    max-width: 420px;
    margin: 2rem auto;
    background: var(--paper);
    border-radius: 24px;
    border: 1px solid rgba(180, 134, 76, 0.25);
    box-shadow: 0 20px 50px rgba(31, 51, 71, 0.15);
    padding: 2.6rem 1.8rem;
    text-align: center;
  }
  .lock-card p { font-size: 0.9rem; color: var(--muted); line-height: 1.6; }
  .gallery-grid {
    max-width: 1100px;
    margin: 0 auto;
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(220px, 1fr));
    gap: 0.9rem;
  }
  .gallery-tile {
    position: relative;
    aspect-ratio: 1 / 1;
    border-radius: 12px;
    overflow: hidden;
    background: var(--paper);
    border: 1px solid rgba(180, 134, 76, 0.25);
  }
  .gallery-tile img { width: 100%; height: 100%; object-fit: cover; display: block; cursor: zoom-in; }
  .gallery-tile iframe { width: 100%; height: 100%; border: none; display: block; }
  .gallery-fallback-link {
    position: absolute;
    bottom: 0.4rem; right: 0.4rem;
    background: rgba(31, 51, 71, 0.85);
    color: var(--gold-soft);
    font-size: 0.62rem;
    letter-spacing: 0.05em;
    padding: 0.3rem 0.55rem;
    border-radius: 20px;
    text-decoration: none;
  }
  .gallery-empty, .gallery-error {
    max-width: 420px;
    margin: 2rem auto;
    text-align: center;
    font-size: 0.9rem;
    color: var(--muted);
    line-height: 1.6;
  }
  .gallery-error { color: var(--gold-text); }
  .gallery-lightbox {
    position: fixed; inset: 0;
    background: rgba(31, 51, 71, 0.92);
    display: flex; align-items: center; justify-content: center;
    padding: 2rem;
    cursor: zoom-out;
    z-index: 1000;
  }
  .gallery-lightbox img { max-width: 100%; max-height: 100%; border-radius: 8px; box-shadow: 0 20px 60px rgba(0,0,0,0.5); }
</style>
</head>
<body>
  <div class="header">
    <h1>Nuestros Recuerdos</h1>
    <p>Fotos y vídeos que vais compartiendo hoy, en directo.</p>
    <a class="back-link" href="index.html?open=1">← Volver a la invitación</a>
  </div>

  <div class="lock-card" id="lock-card">
    <p>La galería se activará el día de la boda (24 de octubre de 2026). ¡Vuelve entonces para ver las fotos y vídeos que vayáis compartiendo!</p>
  </div>

  <div class="gallery-grid" id="gallery-grid" hidden></div>
  <p class="gallery-empty" id="gallery-empty" hidden>Aún no hay fotos… ¡sé el primero en compartir! <a class="back-link" href="index.html?open=1#recuerdos">Subir una foto</a></p>
  <p class="gallery-error" id="gallery-error" hidden>No se pudieron cargar las fotos, reintentando…</p>

  <script src="js/gallery.js"></script>
  <script>
    const galleryActive = Date.now() >= new Date('2026-10-24T00:00:00').getTime();
    document.getElementById('lock-card').hidden = galleryActive;
    document.getElementById('gallery-grid').hidden = !galleryActive;
    if (galleryActive) {
      initGallery({ gridId: 'gallery-grid', emptyId: 'gallery-empty', errorId: 'gallery-error' });
    }
  </script>
</body>
</html>
```

- [x] **Paso 3: Añadir enlace "Ver Galería" en `index.html`**

Reemplazar (líneas 866-870):

```html
      <div>
        <button class="btn-line" id="upload-btn"><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M4 8h3l2-3h6l2 3h3v11H4z"/><circle cx="12" cy="13" r="3.2"/></svg> <span id="upload-btn-label">Subir Fotos y Vídeos</span></button>
        <input type="file" id="upload-input" multiple accept="image/*,video/*" style="display:none">
      </div>
    </div>
```

por:

```html
      <div>
        <button class="btn-line" id="upload-btn"><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M4 8h3l2-3h6l2 3h3v11H4z"/><circle cx="12" cy="13" r="3.2"/></svg> <span id="upload-btn-label">Subir Fotos y Vídeos</span></button>
        <input type="file" id="upload-input" multiple accept="image/*,video/*" style="display:none">
      </div>
      <div>
        <a class="btn-line" id="gallery-link" href="galeria.html"><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="14" rx="2"/><path d="M3 14l4.5-4.5a2 2 0 0 1 2.8 0L15 14"/><circle cx="9" cy="9" r="1.2"/></svg> Ver Galería</a>
      </div>
    </div>
```

- [x] **Paso 4: Bloquear el enlace por fecha en `index.html`**

Reemplazar (líneas 1034-1041):

```javascript
  (function () {
    const btn = document.getElementById('upload-btn');
    const btnLabel = document.getElementById('upload-btn-label');
    if (!recuerdosActive) {
      if (btn) btn.classList.add('is-disabled');
      if (btnLabel) btnLabel.textContent = 'Disponible el día de la boda';
    }
  })();
```

por:

```javascript
  (function () {
    const btn = document.getElementById('upload-btn');
    const btnLabel = document.getElementById('upload-btn-label');
    const galleryLink = document.getElementById('gallery-link');
    if (!recuerdosActive) {
      if (btn) btn.classList.add('is-disabled');
      if (btnLabel) btnLabel.textContent = 'Disponible el día de la boda';
      if (galleryLink) galleryLink.classList.add('is-disabled');
    }
  })();
```

- [x] **Paso 5: Verificación manual**

Misma verificación que Task 5 Paso 5, sobre `galeria.html` de este sitio: estado bloqueado por defecto, forzar `galleryActive = true` temporalmente en DevTools para comprobar cuadrícula, lightbox y vídeo embebido con el archivo de prueba de Task 1/2. Revertir el cambio temporal.

- [x] **Paso 6: Commit**

```bash
cd "C:/Users/jukkaP/Desktop/skill/Nueva carpeta/invitación-dani-irene"
git add js/gallery.js galeria.html index.html
git commit -m "Añade galería de fotos en vivo sincronizada con Drive"
```

Nota: este repo ya tenía cambios sin commitear de una sesión anterior (subida de fotos: `js/upload.js`, `subir.html`, edición de `index.html`). El `git add` de este paso solo incluye los tres archivos de esta tarea — no arrastra esos cambios previos a este commit.

---

## Notas de la ejecución (desviaciones respecto al plan original)

- **Task 1**: ambas bodas dieron `necesitaNodoShare = false` (verificado con `curl -L` siguiendo redirecciones — el archivo de prueba respondió `200` desde `lh3.googleusercontent.com`). **Task 2 se saltó por completo**, para las dos bodas.
- **`createdTime` no está disponible** en el selector de campos ("Fields") de la operación Search del nodo Google Drive de esta versión de n8n — solo aparece un conjunto fijo de campos (sin `createdTime`). Se resolvió sin depender de él: los archivos ya se suben con el nombre prefijado por su timestamp (`{{$now.toMillis()}}_nombre`, ver workflow de subida existente), así que `js/gallery.js` extrae y ordena por ese prefijo en el propio cliente (`uploadTimestamp()`), en vez de pedir orden a Drive. Los nodos "Search files and folders" de ambos workflows de listado quedaron con `Fields: ID, Name, mimeType` (sin `createdTime`).
- **`drive.google.com/thumbnail?id=...` aplica rate-limiting agresivo a peticiones anónimas repetidas al mismo recurso** (confirmado con `curl`: varias peticiones seguidas al mismo id devolvieron `429`, mientras que `drive.google.com/uc?export=view&id=...` respondió `200` de forma consistente). Se añadió un fallback en `gallery.js`: si la miniatura falla (`<img>` `error` event), se reintenta con `uc?export=view` — tanto en los tiles de la cuadrícula como en el lightbox.
- **Verificación visual de imágenes/vídeos incompleta por una limitación del propio entorno de pruebas**: la extensión Claude-in-Chrome usada para verificar no emite peticiones de red hacia dominios de imágenes de Google (`googleusercontent.com`) — no aparecen ni en el log de red de la pestaña, así que las miniaturas no se pudieron ver renderizadas dentro de esta sesión. Se verificó en su lugar a nivel HTTP con `curl` replicando cabeceras reales de navegador (User-Agent, Referer, Accept), confirmando que ambos endpoints devuelven bytes de imagen válidos (`200`, `Content-Type: image/png`). El resto de la página (fetch al webhook, render de tiles, textos, bloqueo por fecha, botón "Ver Galería") sí se verificó visualmente con capturas de pantalla.
