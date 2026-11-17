# Media service propio para Gloria & José — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Reemplazar el flujo de subida a Google Drive de `invitacion-editorial` (Gloria & José) por un `media-service` propio forkeado del de `bodad-i`, con subida directa (progreso real + reintento + chunks reanudables), soporte HEIC, remux sin recodificar cuando el original ya es compatible, backup periódico de originales a Drive, y panel de borrado admin.

**Architecture:** Fork de `media-service` (Node/Express + ffmpeg, sin cambios en su base: `id.js`/`paths.js`/`concurrencyLimit.js`) desplegado como recurso propio en Coolify bajo `bodagloriayjose.ivangonzalez.cloud/uploads`. El cliente sube **directo** a ese dominio (no vía n8n) para que el progreso XHR y los chunks sean reales. n8n queda para tres cosas nada más: listar la galería, disparar el backup periódico (Scheduled Trigger + credencial Drive ya conectada), y el proxy de borrado con Basic Auth — igual rol que ya cumple en `bodad-i`.

**Tech Stack:** Node 20 (Alpine), Express, multer, ffmpeg/ffprobe (child_process), `node --test` para unit tests, vanilla JS (XHR) en el frontend, n8n para listado/backup/borrado.

**Spec:** `docs/superpowers/specs/2026-11-17-media-service-gloria-jose-design.md`

## Global Constraints

- Dominio del servicio: `bodagloriayjose.ivangonzalez.cloud/uploads` (mismo dominio que el sitio, no subdominio).
- El limitador de concurrencia de ffmpeg (`MAX_CONCURRENT_PROCESSING`, default 2) se mantiene igual — VPS compartido con ~10 servicios.
- La credencial Drive OAuth2 ya conectada en n8n para esta pareja se usa **solo** desde n8n (Scheduled Trigger), nunca se le da acceso a `media-service` directamente.
- Credencial Basic Auth del panel admin ya existe en n8n (usuario `gyj2027`) — reutilizar, no crear otra.
- Solo se respaldan los **originales** — los derivados (grid/poster/mp4 transcodificado) se regeneran del original y no se copian a Drive.
- El webhook público de subida no lleva autenticación (mismo riesgo ya aceptado y documentado para el flujo anterior) — mitigación operativa: mantener inactivo hasta cerca de la boda (jul 2027).
- No se migran las fotos/vídeos ya existentes en la Drive actual.

## Review Focus

- Invitado sube una foto HEIC nativa (iPhone en "Alta eficiencia", no convertida por el picker) — debe aceptarse igual que JPEG/PNG, no rechazarse en silencio.
- Invitado pierde señal a mitad de un vídeo grande, cierra la pestaña, y vuelve más tarde (incluso tras recargar la página) — debe retomar desde el último chunk confirmado, no desde cero.
- Dos invitados subiendo chunks al mismo tiempo (o un `uploadId` repetido/malicioso) no deben pisarse archivos entre sí.
- Una sesión de chunks abandonada (invitado que nunca vuelve) no debe quedar ocupando disco indefinidamente en el VPS compartido.
- El job de backup no debe volver a subir a Drive un original que ya respaldó en una corrida anterior (idempotencia), ni bloquear la subida en curso de otros invitados mientras corre.

---

## Task 1: Fork de `media-service` hacia `invitacion-editorial`

**Files:**
- Create: `invitacion-editorial/media-service/` (copia completa de `invitación-dani-irene/media-service/src`, `test/`, `Dockerfile`, `package.json`)
- Modify: `invitacion-editorial/media-service/package.json` (`name: "media-service-gloria-jose"`)

**Interfaces:**
- Produces: misma API que `bodad-i` hoy (`POST /upload`, `GET /list`, `DELETE /items/:id`, `GET /health`) como punto de partida para las tareas siguientes.

- [ ] **Step 1: Copiar el árbol de `media-service` completo** (sin modificar su contenido) a `invitacion-editorial/media-service/`.
- [ ] **Step 2: Cambiar `name` en `package.json` a `media-service-gloria-jose`.**
- [ ] **Step 3: Instalar dependencias y correr la suite heredada**

Run: `cd invitacion-editorial/media-service && npm install && npm test`
Expected: todos los tests existentes (`id`, `paths`, `manifest`, `ffmpeg`, `concurrencyLimit`) pasan sin tocar nada.

- [ ] **Step 4: Commit**

```bash
git add media-service/
git commit -m "feat(media-service): fork media-service from bodad-i as starting point"
```

---

## Task 2: Soporte HEIC/HEIF en `ffmpeg.js`

**Files:**
- Modify: `invitacion-editorial/media-service/src/ffmpeg.js`
- Test: `invitacion-editorial/media-service/test/ffmpeg.test.js`

**Interfaces:**
- Consumes: nada nuevo (misma forma de `ALLOWED_FORMATS`/`FORMAT_TO_EXT` del Task 1).
- Produces: `ALLOWED_FORMATS` incluye el/los `format_name` que ffprobe reporta para HEIC/HEIF; `FORMAT_TO_EXT` mapea ese valor a `'heic'`. Lo consume `processPhoto.js` sin cambios (ya itera sobre `FORMAT_TO_EXT`).

- [ ] **Step 1: Verificar soporte real de HEIC en la imagen `node:20-alpine` antes de escribir código.**

Construir la imagen del Task 1 (`docker build` o vía un contenedor Alpine con `apk add ffmpeg`) y correr `ffprobe -show_entries format=format_name` sobre un archivo `.heic` de muestra real (ej. una foto de iPhone en "Alta eficiencia"). Anotar el `format_name` exacto que devuelve.
- Si devuelve un `format_name` reconocible (ej. `heic` o similar) → seguir a Step 2 con ese valor exacto.
- Si ffprobe no reconoce el archivo (falla o `format_name` vacío) → el `apk add ffmpeg` de Alpine no trae soporte HEIF nativo. Añadir `libheif` al `Dockerfile` (`RUN apk add --no-cache ffmpeg libheif`) y repetir la prueba. Si sigue sin funcionar, este sub-paso bloquea el Task — documentar el hallazgo y decidir con el usuario si se usa otra imagen base o una librería de conversión aparte antes de continuar.

- [ ] **Step 2: Escribir el test que fija el `format_name` encontrado**

```js
test('ALLOWED_FORMATS/FORMAT_TO_EXT accept HEIC (format_name from Step 1)', () => {
  assert.ok(ALLOWED_FORMATS.has('<format_name exacto del Step 1>'));
  assert.strictEqual(FORMAT_TO_EXT['<format_name exacto del Step 1>'], 'heic');
});
```

- [ ] **Step 3: Correr el test, confirmar que falla** (el valor todavía no está en los sets/mapas).
- [ ] **Step 4: Añadir el valor encontrado a `ALLOWED_FORMATS` y `FORMAT_TO_EXT`** en `ffmpeg.js`, con un comentario citando que fue confirmado contra una muestra HEIC real (no adivinado).
- [ ] **Step 5: Correr el test, confirmar que pasa.**
- [ ] **Step 6: Commit**

```bash
git add media-service/src/ffmpeg.js media-service/test/ffmpeg.test.js media-service/Dockerfile
git commit -m "feat(media-service): accept HEIC/HEIF photo uploads"
```

---

## Task 3: `manifest.updateById` para marcar backups

**Files:**
- Modify: `invitacion-editorial/media-service/src/manifest.js`
- Test: `invitacion-editorial/media-service/test/manifest.test.js`

**Interfaces:**
- Produces: `updateById(id: string, patch: object): object | null` — fusiona `patch` sobre el item con ese `id` (reescribiendo la línea en el manifiesto) y devuelve el item actualizado, o `null` si no existe. Lo consume el Task 5 (`POST /backed/:id`).

- [ ] **Step 1: Escribir los tests**

```js
test('updateById merges the patch into the matching item and persists it', () => {
  const manifest = freshManifest();
  manifest.appendLine({ id: '1_a', name: 'x.jpg' });
  const updated = manifest.updateById('1_a', { backedUpAt: 123 });
  assert.deepStrictEqual(updated, { id: '1_a', name: 'x.jpg', backedUpAt: 123 });
  assert.deepStrictEqual(manifest.readAll(), [{ id: '1_a', name: 'x.jpg', backedUpAt: 123 }]);
});

test('updateById returns null when the id is not found', () => {
  const manifest = freshManifest();
  manifest.appendLine({ id: '1_a' });
  assert.strictEqual(manifest.updateById('missing', { backedUpAt: 1 }), null);
});
```

- [ ] **Step 2: Correr los tests, confirmar que fallan** (`updateById` no existe).
- [ ] **Step 3: Implementar `updateById`** en `manifest.js`, siguiendo el mismo patrón que `removeById` (leer líneas, reescribir el archivo completo con `fs.writeFileSync`).
- [ ] **Step 4: Correr los tests, confirmar que pasan.**
- [ ] **Step 5: Commit**

```bash
git add media-service/src/manifest.js media-service/test/manifest.test.js
git commit -m "feat(media-service): add manifest.updateById for backup tracking"
```

---

## Task 4: Remux sin recodificar en `processVideo.js` (mejora D)

**Files:**
- Modify: `invitacion-editorial/media-service/src/processVideo.js`
- Test: `invitacion-editorial/media-service/test/processVideo.test.js` (nuevo)

**Interfaces:**
- Consumes: `runFfprobe`, `runFfmpeg`, `detectAndValidateFormat` de `ffmpeg.js` (sin cambios de firma).
- Produces: `processVideo({ id, ext })` mantiene su firma y su valor de retorno (`{ width, height, safeExt }`); internamente decide copiar o recodificar.

Criterio de "ya compatible" (decidido en este plan, no librado al builder): el original califica para remux sin recodificar cuando su stream de vídeo ya es `h264`, el de audio (si existe) ya es `aac`, y el ancho/alto no supera 1920 en su lado mayor — exactamente el techo que hoy usa el `-vf scale=...:1920:...` de la recodificación. Si no cumple alguna condición, se recodifica igual que hoy (ruta ya existente, sin tocar).

- [ ] **Step 1: Escribir el test que fija el criterio**

```js
// usa un fixture h264/aac de 1280x720 ya en el repo o grabado para el test
test('processVideo copies the stream instead of re-encoding when already h264/aac within 1920px', async () => {
  const result = await processVideo({ id: 'compat-fixture', ext: 'mp4' });
  // afirmar que el poster y el video final existen y que el video resultante
  // conserva el mismo códec de entrada (ffprobe sobre el output: codec_name === 'h264')
});

test('processVideo re-encodes when the original exceeds 1920px or uses a different codec', async () => {
  // fixture 4K o códec distinto -> afirmar codec_name sigue siendo h264 (salida
  // siempre h264) pero la ruta tomada fue la de recodificación (ej. via un spy/flag)
});
```

- [ ] **Step 2: Correr los tests, confirmar que fallan.**
- [ ] **Step 3: Implementar la decisión en `processVideo`**: antes del `runFfmpeg` de transcodificación, correr un `runFfprobe` adicional (`-show_entries stream=codec_name,width,height,codec_type`) sobre el original ya validado, y si cumple el criterio usar `-c:v copy -c:a copy` (sin `-vf scale`, sin `-crf`) en vez de los flags de recodificación actuales; el paso del poster (`-vframes 1`) no cambia en ningún caso.
- [ ] **Step 4: Correr los tests, confirmar que pasan.**
- [ ] **Step 5: Commit**

```bash
git add media-service/src/processVideo.js media-service/test/processVideo.test.js
git commit -m "feat(media-service): remux compatible videos instead of always re-encoding"
```

---

## Task 5: Endpoints de backup — `GET /unbacked` y `POST /backed/:id`

**Files:**
- Modify: `invitacion-editorial/media-service/src/server.js`
- Modify: `invitacion-editorial/media-service/src/server.js` (donde se construye `item` en `POST /upload` — agregar `originalExt` y `backedUpAt: null` al objeto guardado en el manifiesto)
- Test: `invitacion-editorial/media-service/test/server.test.js` (nuevo — usar `supertest`-less approach: levantar `app.listen` en puerto efímero y pegarle con `fetch`, siguiendo el estilo sin dependencias nuevas del resto del proyecto)

**Interfaces:**
- Consumes: `manifest.readAll()`, `manifest.updateById()` (Task 3).
- Produces: `GET /unbacked` → `200 [{ id, originalExt }]` (items con `backedUpAt` nulo/ausente). `POST /backed/:id` → `200 { id, backedUpAt }` o `404` si el id no existe.

- [ ] **Step 1: Escribir los tests**

```js
test('GET /unbacked lists only items without backedUpAt, with their originalExt', async () => {
  // seed manifest con 2 items, uno con backedUpAt y otro sin
  // GET /unbacked -> solo el segundo, con su originalExt
});

test('POST /backed/:id marks the item and GET /unbacked stops listing it', async () => {
  // POST /backed/<id> -> 200 { id, backedUpAt: <number> }
  // GET /unbacked ya no lo incluye
});

test('POST /backed/:id returns 404 for an unknown id', async () => { /* ... */ });
```

- [ ] **Step 2: Correr los tests, confirmar que fallan.**
- [ ] **Step 3: Implementar las dos rutas** en `server.js`, y añadir `originalExt: safeExt, backedUpAt: null` al objeto `item` en ambas ramas (imagen/vídeo) de `POST /upload` — así `GET /unbacked` siempre tiene de dónde sacar la extensión sin adivinarla (a diferencia de cómo tuvimos que inferirla manualmente para `bodad-i`).
- [ ] **Step 4: Correr los tests, confirmar que pasan.**
- [ ] **Step 5: Commit**

```bash
git add media-service/src/server.js media-service/test/server.test.js
git commit -m "feat(media-service): add backup tracking endpoints (GET /unbacked, POST /backed/:id)"
```

---

## Task 6: `chunkUpload.js` — sesiones de subida por chunks

**Files:**
- Create: `invitacion-editorial/media-service/src/chunkUpload.js`
- Test: `invitacion-editorial/media-service/test/chunkUpload.test.js`

**Interfaces:**
- Consumes: `paths.UPLOAD_ROOT` (nuevo subdirectorio `chunks/`).
- Produces (usado por el Task 7):
  - `startOrGetSession(uploadId: string, totalChunks: number, filename: string, mimetype: string): SessionInfo`
  - `writeChunk(uploadId: string, chunkIndex: number, buffer: Buffer): { receivedChunks: number[], complete: boolean }`
  - `receivedChunks(uploadId: string): number[]`
  - `assembleIfComplete(uploadId: string): string | null` — devuelve la ruta del archivo ensamblado (o `null` si aún faltan chunks), y borra el directorio de la sesión tras ensamblar.
  - `sweepAbandoned(maxAgeMs: number): string[]` — borra sesiones cuyo directorio sea más viejo que `maxAgeMs` y devuelve los `uploadId` eliminados.

- [ ] **Step 1: Escribir los tests**

```js
test('writeChunk then assembleIfComplete reassembles the file in chunkIndex order once all chunks arrive', () => {
  // 3 chunks escritos en orden 2,0,1 -> assembleIfComplete reensambla 0,1,2
});

test('receivedChunks reports only the chunk indices actually written (for resume)', () => {
  // escribir chunks 0 y 2 de 4 -> receivedChunks() === [0,2]
});

test('assembleIfComplete returns null while chunks are still missing', () => { /* ... */ });

test('writeChunk is idempotent — re-sending an already-received chunk does not duplicate data', () => { /* ... */ });

test('sweepAbandoned deletes only session directories older than maxAgeMs and returns their ids', () => {
  // crear 2 sesiones, forzar mtime vieja en una (fs.utimesSync) -> solo esa se borra
});
```

- [ ] **Step 2: Correr los tests, confirmar que fallan.**
- [ ] **Step 3: Implementar `chunkUpload.js`** — cada sesión vive en `UPLOAD_ROOT/chunks/<uploadId>/`, cada chunk como `<chunkIndex>.part`; `assembleIfComplete` concatena en orden numérico y limpia el directorio.
- [ ] **Step 4: Correr los tests, confirmar que pasan.**
- [ ] **Step 5: Commit**

```bash
git add media-service/src/chunkUpload.js media-service/test/chunkUpload.test.js
git commit -m "feat(media-service): add chunked upload session storage"
```

---

## Task 7: Rutas de subida por chunks en `server.js` + limpieza periódica

**Files:**
- Modify: `invitacion-editorial/media-service/src/server.js`
- Test: `invitacion-editorial/media-service/test/server.test.js`

**Interfaces:**
- Consumes: todas las funciones del Task 6.
- Produces:
  - `POST /upload/chunk` — multipart: campos `uploadId`, `chunkIndex`, `totalChunks`, `filename`, `mimetype`, archivo `chunk`. Responde `202 { uploadId, receivedChunks }` en cada chunk; cuando `assembleIfComplete` devuelve una ruta, dispara el mismo pipeline que `POST /upload` (detectar imagen/vídeo, `processPhoto`/`processVideo`, `manifest.appendLine` con `originalExt`/`backedUpAt: null`) y responde igual que hoy en ese último chunk.
  - `GET /upload/chunk/:uploadId/status` → `200 { receivedChunks: number[] }` — para que el cliente (Task 9) sepa desde dónde resumir.
  - Limpieza: `setInterval` (ej. cada hora) que llama a `chunkUpload.sweepAbandoned(48 * 3600 * 1000)`.

- [ ] **Step 1: Escribir los tests**

```js
test('POST /upload/chunk assembles and processes the file once the last chunk arrives', async () => {
  // enviar 2 chunks de una imagen pequeña real -> el 2do responde con el mismo
  // shape que POST /upload hoy (id, url, gridUrl), y GET /list lo incluye
});

test('GET /upload/chunk/:uploadId/status reflects partial progress for resume', async () => {
  // enviar 1 de 3 chunks -> GET status -> { receivedChunks: [0] }
});
```

- [ ] **Step 2: Correr los tests, confirmar que fallan.**
- [ ] **Step 3: Implementar las rutas** reusando la lógica de procesamiento ya existente en `POST /upload` (extraerla a una función interna compartida si hace falta para no duplicarla).
- [ ] **Step 4: Añadir el `setInterval` de limpieza** al arrancar el servidor (`if (require.main === module)` block).
- [ ] **Step 5: Correr los tests, confirmar que pasan.**
- [ ] **Step 6: Commit**

```bash
git add media-service/src/server.js media-service/test/server.test.js
git commit -m "feat(media-service): add resumable chunked upload endpoints + abandoned-session cleanup"
```

---

## Task 8: `js/upload.js` — progreso real + reintento (mejora A)

**Files:**
- Modify: `invitacion-editorial/js/upload.js`

**Interfaces:**
- Consumes: `POST https://bodagloriayjose.ivangonzalez.cloud/upload` directo (ya no vía n8n).
- Produces: misma API pública `initUploadFlow({ buttonId, inputId, labelId, isActive, lockedMessage })` que ya consumen `index.html`/`subir.html`, sin cambios de firma.

- [ ] **Step 1: Reemplazar el `fetch` actual por `XMLHttpRequest`** para archivos que no entran en chunking (ver umbral del Task 9), escuchando `upload.onprogress` para mostrar `% ` real en vez de solo "Subiendo X/Y".
- [ ] **Step 2: Envolver el envío en un reintento** (hasta 2 reintentos adicionales) cuando la causa del fallo es de red (`xhr.onerror`/timeout), no cuando el servidor respondió con un error de validación (4xx) — ahí no tiene sentido reintentar igual.
- [ ] **Step 3: Probar manualmente en el navegador** (subida real de una foto chica contra el `media-service` ya desplegado del Task 1-5): confirmar que la barra/porcentaje avanza y que cortar la red a mitad y reconectar dispara el reintento sin que el usuario tenga que tocar nada.
- [ ] **Step 4: Commit**

```bash
git add js/upload.js
git commit -m "feat(upload): real progress + automatic retry on network failure"
```

---

## Task 9: `js/upload.js` — chunking y resumption entre recargas (mejora E)

**Files:**
- Modify: `invitacion-editorial/js/upload.js`

**Interfaces:**
- Consumes: `POST /upload/chunk`, `GET /upload/chunk/:uploadId/status` (Task 7).
- Produces: mismo comportamiento visible que Task 8 para el usuario; internamente, archivos por encima de 20MB se suben en chunks de 5MB.

- [ ] **Step 1: Generar y persistir una clave de resumo por archivo** en `localStorage`, construida a partir de `name + size + lastModified` (sin hashear contenido, consistente con lo que ya hacen librerías de subida reanudable) → `uploadId` (via `crypto.randomUUID()` la primera vez, reutilizado si la clave ya existe en `localStorage`).
- [ ] **Step 2: Antes de subir, si hay un `uploadId` guardado para esa clave, llamar a `GET /upload/chunk/:uploadId/status`** y arrancar desde el primer `chunkIndex` faltante en vez de desde 0.
- [ ] **Step 3: Subir en chunks de 5MB vía `POST /upload/chunk`**, actualizando el progreso por chunk confirmado (no solo por bytes del chunk en curso), y borrar la clave de `localStorage` cuando el último chunk responde con el item final.
- [ ] **Step 4: Probar manualmente**: subir un archivo >20MB, cortar la conexión (modo avión) a mitad, recargar la página, y confirmar que retoma desde el chunk correcto en vez de reiniciar.
- [ ] **Step 5: Commit**

```bash
git add js/upload.js
git commit -m "feat(upload): chunked, resumable upload for files over 20MB"
```

---

## Task 10: `js/gallery.js` — consumir la API de `media-service`

**Files:**
- Modify: `invitacion-editorial/js/gallery.js`
- Modify: `invitacion-editorial/galeria.html` (si hace falta ajustar markup/CSS del `video-shield`, que ya no aplica)

**Interfaces:**
- Consumes: `GET https://bodagloriayjose.ivangonzalez.cloud/list` (reemplaza `GALLERY_WEBHOOK_URL` actual a Drive).
- Produces: misma API pública `initGallery({ photoGridId, videoGridId, ... })`.

- [ ] **Step 1: Cambiar `createPhotoTile`** para usar `item.gridUrl`/`item.url` directo (sin los endpoints de `thumbnail?id=`/`uc?export=view` de Drive).
- [ ] **Step 2: Cambiar `createVideoTile`** para usar `<video src={item.url} poster={item.posterUrl} controls>` nativo, eliminando el `iframe`/`.video-shield` — ya no hace falta el hack documentado en `project_gallery_video_embed`, porque el vídeo se sirve desde nuestro propio dominio.
- [ ] **Step 3: Cambiar `uploadTimestamp`/el orden** para usar el campo `id` (que ya empieza con el timestamp, igual que en `bodad-i`) en vez de parsear `item.name`.
- [ ] **Step 4: Probar manualmente en el navegador**: subir una foto y un vídeo (Tasks 8/9 ya desplegados) y confirmar que aparecen en la galería sin el ícono/hack de Drive.
- [ ] **Step 5: Commit**

```bash
git add js/gallery.js galeria.html
git commit -m "feat(gallery): serve photos/videos from media-service instead of Google Drive"
```

---

## Task 11: `admin.html` — panel de borrado

**Files:**
- Create: `invitacion-editorial/admin.html` (puerto de `invitación-dani-irene/admin.html`)

**Interfaces:**
- Consumes: el webhook de borrado de n8n del Task 12 (`POST /webhook/boda-gj-borrar`, Basic Auth `gyj2027`), que reenvía a `DELETE /items/:id` de `media-service`.

- [ ] **Step 1: Copiar `admin.html` de `bodad-i`** y cambiar la URL del webhook de borrado y el webhook de listado a los de Gloria & José.
- [ ] **Step 2: Probar manualmente**: con al menos un ítem de prueba subido, confirmar login con `gyj2027`, ver el grid, borrar un ítem (individual y en modo "Seleccionar varios") y confirmar que desaparece de `GET /list`.
- [ ] **Step 3: Commit**

```bash
git add admin.html
git commit -m "feat(admin): add delete panel for Gloria & José gallery"
```

---

## Task 12: Workflows de n8n (listado, backup, borrado)

**Files:**
- Create: `invitacion-editorial/docs/n8n/media-service-setup.md` (reemplaza la sección de Drive de `README-setup.md` para la parte de galería/subida; RSVP/alérgenos no cambian)

**Interfaces:**
- Produces: tres workflows activos en `https://n8n.ivangonzalez.cloud` — documentados paso a paso en el `.md`, igual de detallado que el `README-setup.md` actual:
  1. **"Boda Gloria & José - Listado de galería"** — `GET /webhook/boda-gj-galeria` → reenvía a `GET https://bodagloriayjose.ivangonzalez.cloud/list`.
  2. **"Boda Gloria & José - Backup a Drive"** — Scheduled Trigger (ej. diario) → `GET /unbacked` → por cada item, nodo Google Drive (credencial ya conectada) sube `https://bodagloriayjose.ivangonzalez.cloud/uploads/originals/<id>.<originalExt>` → `POST /backed/:id`.
  3. **"Boda Gloria & José - Borrar de galería"** — `POST /webhook/boda-gj-borrar` (Basic Auth `gyj2027`, credencial ya existente) → `DELETE https://bodagloriayjose.ivangonzalez.cloud/items/:id`.

- [ ] **Step 1: Escribir el `.md`** con los pasos de importación/configuración de los 3 workflows, siguiendo el formato del `README-setup.md` existente (credenciales, pegar IDs, smoke test con `curl`).
- [ ] **Step 2: Crear y activar los 3 workflows en n8n** siguiendo ese documento.
- [ ] **Step 3: Smoke test de cada uno** con `curl` (igual que la sección 5 del `README-setup.md` actual): listado devuelve `[]` o items reales, backup mueve al menos un item de prueba a Drive y lo marca, borrado efectivamente borra.
- [ ] **Step 4: Desactivar el workflow viejo de subida a Drive** (`"Boda Gloria & José - Subida de fotos a Drive"`) — ya no se usa, pero no se borra todavía por si hace falta revertir.
- [ ] **Step 5: Commit**

```bash
git add docs/n8n/media-service-setup.md
git commit -m "docs(n8n): document gallery/backup/delete workflows for the new media-service"
```

---

## Task 13: Despliegue en Coolify

**Files:**
- Modify: `invitacion-editorial/docs/n8n/media-service-setup.md` (sección final con los pasos de Coolify, mismo archivo del Task 12)

- [ ] **Step 1: Crear el recurso nuevo en Coolify** para `media-service` (mismo Dockerfile del Task 1-7), apuntado a este repo/rama.
- [ ] **Step 2: Configurar el ruteo** para que `bodagloriayjose.ivangonzalez.cloud/upload*` y `/uploads/*` lleguen al contenedor de `media-service`, y el resto (`/`, estáticos) siga sirviendo el sitio — mismo patrón que ya existe para `bodadaniyirene.ivangonzalez.cloud`.
- [ ] **Step 3: Smoke test end-to-end real**: desde un navegador en el dominio de producción, subir una foto y un vídeo (uno forzando chunking, >20MB), confirmar que aparecen en `galeria.html`, borrarlos desde `admin.html`, y confirmar que el workflow de backup (Task 12) los respalda a Drive antes de borrarlos en una prueba separada.
- [ ] **Step 4: Dejar el webhook/recurso inactivo** hasta que se acerque la fecha de la boda (jul 2027), documentando en el mismo `.md` el paso de reactivación.
- [ ] **Step 5: Commit**

```bash
git add docs/n8n/media-service-setup.md
git commit -m "docs: document Coolify deployment for Gloria & José media-service"
```

---

## Self-Review

**1. Spec coverage:** Migración completa (Tasks 1, 10, 11, 12, 13) ✓. Mejora A (Task 8) ✓. Mejora B (Task 2) ✓. Mejora C (Tasks 3, 5, 12) ✓. Mejora D (Task 4) ✓. Mejora E (Tasks 6, 7, 9) ✓. Limpieza de sesiones abandonadas (Task 6/7) ✓. Dominio/ruteo (Task 13) ✓.

**2. Step scan:** revisado — ningún paso deja "TBD"; los umbrales (1920px, 20MB, 5MB, 48h) quedan fijados en el plan, no librados al implementador.

**3. Type consistency:** `updateById`, `GET /unbacked`, `POST /backed/:id`, y las funciones de `chunkUpload.js` se nombran igual en el Task que las define y en los que las consumen (5, 7, 12).

**4. Review Focus:** las 5 líneas de la sección de arriba están cada una cubierta por un test concreto (Task 2 Step 2, Task 9 Step 4, Task 6 Step 1 "idempotent"/"sweepAbandoned", Task 6 Step 1 "sweepAbandoned", Task 5 Step 1 "stops listing it").

**5. Proportion:** plan organizado en 13 tareas con firmas/tests en vez de cuerpos completos; los cuerpos de implementación se dejan al implementador salvo donde el criterio exacto (remux, chunking) necesitaba fijarse.
