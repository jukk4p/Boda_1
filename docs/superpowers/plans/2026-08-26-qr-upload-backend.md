# Backend de Subida de Fotos/Vídeos vía QR — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Sustituir el QR y el botón de subida decorativos de `#recuerdos` (index.html) por un QR real y un flujo de subida real: los invitados suben fotos/vídeos que llegan a una carpeta de Google Drive a través de un workflow de n8n, sin backend propio.

**Architecture:** Un generador de QR vendorizado (JS puro, sin CDN) pinta un QR real que enlaza a `#recuerdos` en el propio dominio. Un `<input type="file">` oculto + `fetch()` envían cada archivo por `multipart/form-data` a un Webhook de producción de n8n; un workflow de n8n (Webhook → Google Drive → Respond) sube el archivo a la carpeta compartida y responde éxito/error. El proxy (Coolify/Traefik) delante de n8n debe aceptar bodies de hasta 80 MB.

**Tech Stack:** HTML/CSS/JS vanilla (sin build ni framework), librería `qrcode-generator` (MIT, vendorizada localmente), n8n (Webhook + Google Drive nodes), Coolify/Traefik como proxy inverso.

**Spec:** `docs/superpowers/specs/2026-08-26-qr-upload-backend-design.md`

## Global Constraints

- Almacenamiento final: carpeta de Google Drive ya compartida (no backend propio de almacenamiento).
- Backend: workflow de n8n (Webhook → Google Drive → Respond); nada de servidor Node/Python nuevo.
- El QR enlaza a `#recuerdos` en el propio dominio, no a una página aparte.
- Límite de tamaño de archivo validado en frontend: **50 MB**.
- Límite de body a nivel de proxy (Coolify/Traefik delante de n8n): **80 MB** (`client_max_body_size`/`maxRequestBodyBytes` equivalente).
- Tipos aceptados: `image/*` y `video/*`.
- Sin dependencias cargadas desde CDN en runtime — cualquier librería de terceros se vendoriza (se descarga una vez y se commitea en el repo).
- No se introduce build system, bundler ni gestor de paquetes: el sitio sigue siendo HTML/CSS/JS servidos tal cual.
- Se respeta el bloqueo existente (`uploadActive`, clase `is-locked`, overlay de candado) hasta el 31 de julio de 2027, hora de la boda — no se debe desactivar permanentemente para probar.

---

### Task 1: Vendorizar el generador de QR

**Files:**
- Create: `js/qrcode.js`

**Interfaces:**
- Produces: global `qrcode(typeNumber, errorCorrectionLevel)` (función factoría del script vendorizado), con métodos de instancia `.addData(text)`, `.make()`, `.createSvgTag(cellSize, margin)`. Usado por la Task 2.

- [ ] **Step 1: Crear la carpeta `js/` y descargar la librería (versión fijada v20170724)**

```bash
mkdir -p js
curl -sL https://raw.githubusercontent.com/kazuhikoarase/qrcode-generator/v20170724/js/qrcode.js -o js/qrcode.js
```

- [ ] **Step 2: Verificar la integridad del archivo descargado**

```bash
sha256sum js/qrcode.js
```

Expected: `c07680db88c9d87597a371fd10cc542bd1e143df77b03941d6803a38382fb28e  js/qrcode.js`

Si el hash no coincide, no continuar: repetir la descarga o investigar por qué difiere antes de usar el archivo.

- [ ] **Step 3: Verificar que expone la API esperada**

```bash
grep -n "^var qrcode = function(typeNumber" js/qrcode.js
grep -n "createSvgTag = function" js/qrcode.js
```

Expected: la primera línea imprime algo como `29:var qrcode = function(typeNumber, errorCorrectionLevel) {` y la segunda algo como `495:    _this.createSvgTag = function(cellSize, margin) {`.

- [ ] **Step 4: Commit**

```bash
git add js/qrcode.js
git commit -m "Vendoriza qrcode-generator (MIT, kazuhikoarase v20170724) para el QR real"
```

---

### Task 2: Renderizar un QR real que enlace a #recuerdos

**Files:**
- Modify: `index.html` (incluir el script vendorizado, sustituir el SVG falso por un contenedor, generar el QR)

**Interfaces:**
- Consumes: `qrcode(typeNumber, errorCorrectionLevel)` de `js/qrcode.js` (Task 1).
- Produces: contenedor `#qr-canvas` en el DOM, relleno con un `<svg>` al cargar la página. No expone nada que otras tasks consuman directamente.

- [ ] **Step 1: Incluir el script vendorizado antes del script principal**

Buscar (cerca del final del `<body>`, justo antes del bloque `<script>` principal):

```html
</div>

<script>
  // ── PANTALLA DE APERTURA ───────────────────────────
  function openInvitation() {
```

Reemplazar por:

```html
</div>

<script src="js/qrcode.js"></script>
<script>
  // ── PANTALLA DE APERTURA ───────────────────────────
  function openInvitation() {
```

- [ ] **Step 2: Sustituir el SVG falso del QR por un contenedor real**

Buscar (dentro de la sección "RECUERDOS & QR"):

```html
        <svg width="140" height="140" viewBox="0 0 100 100" fill="#1a382b">
          <path d="M0 0h35v35H0zM5 5v25h25V5zm5 5h15v15H10zM65 0h35v35H65zM70 5v25h25V5zm5 5h15v15H75zM0 65h35v35H0zM5 70v25h25V70zm5 5h15v15H10zM40 5h15v15H40zM40 25h10v10H40zM45 40h20v10H45zM25 45h15v15H25zM65 45h15v15H65zM85 45h15v20H85zM45 65h10v20H45zM60 65h20v10H60zM75 80h20v20H75zM55 85h15v15H55z"/>
        </svg>
```

Reemplazar por:

```html
        <div id="qr-canvas" role="img" aria-label="Código QR para subir tus fotos y vídeos" style="width:140px; height:140px;"></div>
```

- [ ] **Step 3: Generar el QR al cargar la página**

Buscar (bloque de bloqueo de subida, ya existente):

```js
      if (btnLabel) btnLabel.textContent = 'Disponible el día de la boda';
    }
  })();
  function handleUploadClick() {
```

Reemplazar por:

```js
      if (btnLabel) btnLabel.textContent = 'Disponible el día de la boda';
    }
  })();

  // ── QR REAL: enlaza a la sección de Recuerdos ──────
  (function generateQr() {
    const qrCanvas = document.getElementById('qr-canvas');
    if (!qrCanvas || typeof qrcode !== 'function') return;
    const qrUrl = location.origin + location.pathname + '#recuerdos';
    const qr = qrcode(0, 'M');
    qr.addData(qrUrl);
    qr.make();
    qrCanvas.innerHTML = qr.createSvgTag(4, 8).replace(/fill="black"/, 'fill="#1a382b"');
  })();

  function handleUploadClick() {
```

- [ ] **Step 4: Verificación manual en navegador**

```bash
python -m http.server 8000
```

Abrir `http://localhost:8000/index.html` (o `http://TU_IP_LOCAL:8000/index.html` desde el móvil, para poder escanear).

Expected:
- En la sección "Comparte tus Recuerdos", donde antes había el falso QR ahora hay un `<svg>` real dentro de `#qr-canvas` (comprobar con el inspector de DevTools).
- El overlay de candado ("Disponible el 31 de Julio de 2027") sigue mostrándose encima, igual que antes.
- Al escanear el QR con la cámara del móvil, la URL detectada termina en `#recuerdos` y corresponde a la página servida.

- [ ] **Step 5: Commit**

```bash
git add index.html
git commit -m "Sustituye el QR decorativo por un QR real generado en cliente"
```

---

### Task 3: Flujo real de subida de archivos (input oculto + fetch)

**Files:**
- Modify: `index.html` (input de archivo oculto, `handleUploadClick`, listener de subida)

**Interfaces:**
- Consumes: `uploadActive` (booleano ya existente en el script), elementos `#upload-btn-label`.
- Produces: constante `WEBHOOK_URL` (placeholder hasta la Task 5) y el envío `multipart/form-data` con el campo binario llamado `data` — nombre de campo que la Task 4 debe esperar en el Webhook de n8n.

- [ ] **Step 1: Añadir el input de archivo oculto junto al botón**

Buscar:

```html
      <div>
        <button class="btn-gold" id="upload-btn" onclick="handleUploadClick()">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6"><path d="M4 8h3l2-3h6l2 3h3v11H4z"/><circle cx="12" cy="13" r="3.2"/></svg> <span id="upload-btn-label">Subir Fotos y Vídeos</span>
        </button>
      </div>
```

Reemplazar por:

```html
      <div>
        <button class="btn-gold" id="upload-btn" onclick="handleUploadClick()">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6"><path d="M4 8h3l2-3h6l2 3h3v11H4z"/><circle cx="12" cy="13" r="3.2"/></svg> <span id="upload-btn-label">Subir Fotos y Vídeos</span>
        </button>
        <input type="file" id="upload-input" multiple accept="image/*,video/*" style="display:none">
      </div>
```

- [ ] **Step 2: Sustituir `handleUploadClick` y añadir el listener de subida**

Buscar:

```js
  function handleUploadClick() {
    if (!uploadActive) {
      alert('¡Esta sección se activará el día de la boda (31 de julio de 2027)! Guardad vuestras fotos y compartidlas con nosotros ese día. 💍');
      return;
    }
    alert('Formulario de carga de fotos activado para los invitados.');
  }
```

Reemplazar por:

```js
  // ── SUBIDA DE ARCHIVOS: envío al webhook de n8n ────
  const WEBHOOK_URL = 'https://n8n.TUDOMINIO/webhook/boda-fotos'; // TODO(Task 5): sustituir por la URL real del webhook de producción
  const MAX_FILE_SIZE_BYTES = 50 * 1024 * 1024;
  const ALLOWED_TYPE_PREFIXES = ['image/', 'video/'];

  function handleUploadClick() {
    if (!uploadActive) {
      alert('¡Esta sección se activará el día de la boda (31 de julio de 2027)! Guardad vuestras fotos y compartidlas con nosotros ese día. 💍');
      return;
    }
    document.getElementById('upload-input').click();
  }

  document.getElementById('upload-input').addEventListener('change', async (e) => {
    const files = Array.from(e.target.files);
    e.target.value = '';
    if (files.length === 0) return;

    const btnLabel = document.getElementById('upload-btn-label');
    const originalLabel = 'Subir Fotos y Vídeos';
    let okCount = 0;
    let failCount = 0;

    for (let i = 0; i < files.length; i++) {
      const file = files[i];
      btnLabel.textContent = `Subiendo ${i + 1}/${files.length}…`;

      const isAllowedType = ALLOWED_TYPE_PREFIXES.some(p => file.type.startsWith(p));
      if (!isAllowedType || file.size > MAX_FILE_SIZE_BYTES) {
        failCount++;
        continue;
      }

      try {
        const formData = new FormData();
        formData.append('data', file, file.name);
        const res = await fetch(WEBHOOK_URL, { method: 'POST', body: formData });
        if (res.ok) { okCount++; } else { failCount++; }
      } catch (err) {
        failCount++;
      }
    }

    if (failCount === 0) {
      btnLabel.textContent = '¡Gracias, recibido!';
    } else if (okCount > 0) {
      btnLabel.textContent = `${okCount} subida(s), ${failCount} con error`;
    } else {
      btnLabel.textContent = 'Hubo un problema, inténtalo de nuevo';
    }
    setTimeout(() => { btnLabel.textContent = originalLabel; }, 3000);
  });
```

- [ ] **Step 3: Verificación manual con un endpoint temporal (sin depender de n8n todavía)**

1. Ir a `https://webhook.site` y copiar la URL única que genera.
2. En una copia local sin commitear, cambiar temporalmente `WEBHOOK_URL` por esa URL de webhook.site.
3. Cambiar temporalmente la fecha de referencia de `uploadActive` (línea `const uploadActive = Date.now() >= new Date('2027-07-31T00:00:00').getTime();`) por una fecha pasada, ej. `'2020-01-01T00:00:00'`, solo para poder probar localmente.
4. `python -m http.server 8000`, abrir `http://localhost:8000/index.html`, pulsar "Subir Fotos y Vídeos", elegir una imagen pequeña.

Expected:
- La etiqueta del botón muestra `Subiendo 1/1…` y luego `¡Gracias, recibido!`, volviendo al texto original a los 3 segundos.
- En webhook.site aparece una petición `POST` con un campo de archivo llamado `data`.

5. Repetir seleccionando un archivo `.txt`.

Expected: no aparece ninguna petición nueva en webhook.site, y la etiqueta pasa a `Hubo un problema, inténtalo de nuevo` (se rechaza en cliente antes de enviarse).

6. **Revertir** los cambios temporales de `WEBHOOK_URL` y de la fecha en `uploadActive` (`git diff` debe mostrar solo los cambios de los Steps 1-2, nada más) antes de continuar.

- [ ] **Step 4: Commit**

```bash
git add index.html
git commit -m "Sustituye el alert falso de subida por un envío real vía fetch"
```

---

### Task 4: Workflow de n8n (Webhook → Google Drive) y guía de configuración

**Files:**
- Create: `docs/n8n/boda-fotos-workflow.json`
- Create: `docs/n8n/README-setup.md`

**Interfaces:**
- Consumes: el campo binario `data` enviado por el frontend (Task 3).
- Produces: una URL de webhook de producción de n8n que la Task 5 pegará en `WEBHOOK_URL`.

- [ ] **Step 1: Crear el workflow importable**

Create `docs/n8n/boda-fotos-workflow.json`:

```json
{
  "name": "Boda - Subida de fotos a Drive",
  "nodes": [
    {
      "parameters": {
        "httpMethod": "POST",
        "path": "boda-fotos",
        "responseMode": "responseNode",
        "options": {
          "binaryData": true
        }
      },
      "id": "webhook-boda-fotos",
      "name": "Webhook",
      "type": "n8n-nodes-base.webhook",
      "typeVersion": 2,
      "position": [260, 300],
      "webhookId": "boda-fotos"
    },
    {
      "parameters": {
        "resource": "file",
        "operation": "upload",
        "name": "={{ $now.toMillis() }}_{{ $binary.data.fileName }}",
        "driveId": {
          "mode": "list",
          "value": "My Drive"
        },
        "folderId": {
          "mode": "id",
          "value": "PON_AQUI_EL_FOLDER_ID"
        },
        "options": {}
      },
      "id": "google-drive-upload",
      "name": "Google Drive",
      "type": "n8n-nodes-base.googleDrive",
      "typeVersion": 3,
      "position": [500, 300],
      "credentials": {
        "googleDriveOAuth2Api": {
          "id": "REEMPLAZAR_CON_ID_DE_CREDENCIAL",
          "name": "Google Drive account"
        }
      },
      "onError": "continueErrorOutput"
    },
    {
      "parameters": {
        "respondWith": "json",
        "responseBody": "={{ { ok: true } }}"
      },
      "id": "respond-ok",
      "name": "Respond OK",
      "type": "n8n-nodes-base.respondToWebhook",
      "typeVersion": 1,
      "position": [740, 220]
    },
    {
      "parameters": {
        "respondWith": "json",
        "responseCode": 500,
        "responseBody": "={{ { ok: false, error: 'upload_failed' } }}"
      },
      "id": "respond-error",
      "name": "Respond Error",
      "type": "n8n-nodes-base.respondToWebhook",
      "typeVersion": 1,
      "position": [740, 400]
    }
  ],
  "connections": {
    "Webhook": {
      "main": [
        [ { "node": "Google Drive", "type": "main", "index": 0 } ]
      ]
    },
    "Google Drive": {
      "main": [
        [ { "node": "Respond OK", "type": "main", "index": 0 } ],
        [ { "node": "Respond Error", "type": "main", "index": 0 } ]
      ]
    }
  }
}
```

- [ ] **Step 2: Crear la guía de configuración**

Create `docs/n8n/README-setup.md`:

```markdown
# Configurar el workflow de subida de fotos en n8n

## 1. Credencial de Google Drive

1. En Google Cloud Console, crea (o reutiliza) un proyecto, habilita la
   "Google Drive API" y crea una credencial OAuth Client ID de tipo
   "Web application".
2. En n8n: Settings → Credentials → New → busca "Google Drive OAuth2 API".
3. n8n te muestra un "OAuth Redirect URL": pégalo en la credencial de
   Google Cloud como Authorized redirect URI.
4. Copia el Client ID y Client Secret de Google Cloud a la credencial de
   n8n, guarda y pulsa "Connect my account", autorizando con la cuenta de
   Google dueña de la carpeta compartida.

## 2. Obtener el Folder ID

Abre la carpeta de Drive en el navegador. El Folder ID es el fragmento
final de la URL:

`https://drive.google.com/drive/folders/ESTE_ES_EL_FOLDER_ID`

## 3. Importar el workflow

1. En n8n: Workflows → Import from File → selecciona
   `docs/n8n/boda-fotos-workflow.json`.
2. Abre el nodo **Google Drive**:
   - En "Credential to connect with", selecciona la credencial creada en
     el paso 1 (sustituye el placeholder `REEMPLAZAR_CON_ID_DE_CREDENCIAL`).
   - En "Folder", pega el Folder ID del paso 2 (sustituye
     `PON_AQUI_EL_FOLDER_ID`).
   - Si el campo "Name" da error de expresión en tu versión de n8n,
     simplifícalo a `={{ $binary.data.fileName }}` (sin timestamp).
3. Si al importar algún nodo aparece marcado como "unrecognized node
   version", ábrelo: n8n ofrece actualizarlo a la versión disponible en tu
   instancia sin perder la configuración ya introducida.
4. Activa el workflow (interruptor "Active" arriba a la derecha). Esto
   pasa el Webhook de modo test a modo producción.
5. Abre el nodo **Webhook** y copia la "Production URL" — esa es la URL
   que va en la constante `WEBHOOK_URL` de `index.html` (Task 5).

## 4. Subir el límite de tamaño de body en el proxy

Coolify pone n8n detrás de Traefik. Por defecto Traefik no limita el
tamaño del body, pero si tu instancia sí lo hace (o si ves errores 413 al
subir vídeos), añade en Coolify, en la configuración del recurso de n8n,
en el campo de "Custom Traefik Labels" (o equivalente en tu versión de
Coolify):

\`\`\`
traefik.http.middlewares.n8n-bodylimit.buffering.maxRequestBodyBytes=83886080
traefik.http.routers.<nombre-del-router-de-n8n>.middlewares=n8n-bodylimit
\`\`\`

Sustituye `<nombre-del-router-de-n8n>` por el nombre real del router que
Coolify haya generado para el servicio de n8n (visible en la config
generada del recurso). 83886080 bytes = 80 MB.

## 5. Prueba de humo

\`\`\`bash
curl -F "data=@/ruta/a/una/foto.jpg" https://TU_WEBHOOK_URL
\`\`\`

Expected: la respuesta es `{"ok":true}` y la foto aparece en la carpeta
de Drive en menos de un minuto.
```

- [ ] **Step 3: Commit**

```bash
git add docs/n8n/boda-fotos-workflow.json docs/n8n/README-setup.md
git commit -m "Añade workflow de n8n importable y guía de configuración para subir fotos a Drive"
```

- [ ] **Step 4: Ejecutar la configuración real (fuera del repo, en tu n8n) y la prueba de humo del README**

Expected: `curl` de la prueba de humo devuelve `{"ok":true}` y el archivo aparece en Drive. Anotar la Production URL del Webhook — se usa en la Task 5.

---

### Task 5: Conectar el frontend al webhook real y verificación end-to-end

**Files:**
- Modify: `index.html` (rellenar `WEBHOOK_URL` con la URL real)

**Interfaces:**
- Consumes: la Production URL de n8n obtenida en la Task 4; el flujo de subida de la Task 3; el QR de la Task 2.

- [ ] **Step 1: Rellenar la URL real del webhook**

Buscar:

```js
  const WEBHOOK_URL = 'https://n8n.TUDOMINIO/webhook/boda-fotos'; // TODO(Task 5): sustituir por la URL real del webhook de producción
```

Reemplazar `'https://n8n.TUDOMINIO/webhook/boda-fotos'` por la Production URL copiada en la Task 4, Step 2.5, y quitar el comentario `// TODO(Task 5): ...`.

- [ ] **Step 2: Confirmar que el proxy acepta archivos grandes**

```bash
curl -F "data=@/ruta/a/un/video_de_prueba_30mb.mp4" https://TU_WEBHOOK_URL_REAL
```

Expected: `{"ok":true}` y el vídeo aparece en Drive (confirma que el ajuste de 80 MB de la Task 4 realmente se aplicó).

- [ ] **Step 3: Verificación end-to-end desde un móvil real**

1. Cambiar temporalmente la fecha de `uploadActive` a una fecha pasada (igual que en la Task 3, Step 3) solo para esta prueba, en el sitio ya desplegado o en un entorno de staging — **no** dejar este cambio en producción.
2. Desde un teléfono, escanear el QR de la sección "Comparte tus Recuerdos" con la app de cámara.
3. Confirmar que abre la página en `#recuerdos`.
4. Pulsar "Subir Fotos y Vídeos", elegir una foto real del teléfono.

Expected: la etiqueta del botón pasa por "Subiendo 1/1…" → "¡Gracias, recibido!", y la foto aparece en la carpeta de Drive compartida en menos de un minuto.

5. Revertir el cambio temporal de fecha de `uploadActive` (el sitio debe volver a mostrar el candado hasta el 31 de julio de 2027).

- [ ] **Step 4: Commit**

```bash
git add index.html
git commit -m "Conecta la subida de fotos al webhook de producción de n8n"
```

---

## Self-Review Notes

- **Cobertura del spec**: almacenamiento en Drive (Task 4), backend n8n sin servidor propio (Task 4), QR a `#recuerdos` (Task 2), límite frontend 50MB (Task 3), límite proxy 80MB (Task 4), manejo de errores por archivo sin bloquear el resto (Task 3), sin dependencias de CDN en runtime (Task 1 vendoriza), prueba con móvil real (Task 5). Fuera de alcance del spec (galería, moderación, auth) no tiene tareas — correcto, no debía tenerlas.
- **Placeholders**: los únicos valores pendientes de rellenar (`WEBHOOK_URL`, `PON_AQUI_EL_FOLDER_ID`, `REEMPLAZAR_CON_ID_DE_CREDENCIAL`) son valores de despliegue específicos del entorno del usuario, no huecos de diseño — cada uno tiene una task y un paso concretos que los rellenan con un valor real y verificable.
- **Consistencia de nombres**: el campo binario `data` (Task 3, `formData.append('data', ...)`) coincide con `$binary.data.fileName` usado en el nodo Google Drive (Task 4) y con el nombre de propiedad binaria por defecto del nodo Webhook de n8n.
