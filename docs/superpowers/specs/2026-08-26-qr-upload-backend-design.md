# Backend de subida de fotos/vídeos vía QR — Diseño

Fecha: 2026-08-26

## Contexto

`index.html` es un sitio estático de una sola página (invitación de boda). La
sección "Comparte tus Recuerdos" (`#recuerdos`) tiene:

- Un SVG que simula un QR pero no codifica ninguna URL real.
- Un botón "Subir Fotos y Vídeos" que hoy solo dispara `alert()` — no sube
  nada a ningún sitio.
- Un bloqueo (`is-locked` / `uploadActive`) que mantiene ambos deshabilitados
  hasta el 31 de julio de 2027, hora de la boda.

El sitio se sirve desde un VPS propio gestionado con Coolify, donde también
corre una instancia de n8n. El objetivo es que, el día de la boda, un
invitado pueda escanear el QR (o pulsar el botón si ya tiene la invitación
abierta) y subir fotos/vídeos que terminen en una carpeta de Google Drive
compartida con la pareja.

## Decisiones tomadas

- **Almacenamiento**: carpeta de Google Drive ya existente/compartida.
- **Backend**: workflow de n8n (Webhook → Google Drive → Respond), sin
  backend propio nuevo. Reutiliza la instancia de n8n ya desplegada en
  Coolify.
- **Destino del QR**: la propia invitación, ancla `#recuerdos` (no una
  página aparte).
- **Dominio**: ya existe un dominio propio apuntando al VPS.

## Arquitectura

```
Invitado escanea QR ──► https://TUDOMINIO/#recuerdos
                              │
                    pulsa "Subir Fotos y Vídeos"
                              │
                    <input type="file" multiple>
                              │
                    fetch() POST multipart/form-data
                              │
                              ▼
        https://n8n.TUDOMINIO/webhook/boda-fotos   (n8n, producción)
                              │
                    Webhook node (recibe el archivo)
                              │
                    Google Drive node (Upload a carpeta fija)
                              │
                    Respond to Webhook  { ok: true }  |  { ok: false, error }
```

No hay base de datos ni backend propio: n8n hace de pegamento entre el
navegador del invitado y Google Drive.

## Componentes

### 1. Workflow de n8n (a importar por el usuario)

Tres nodos:

1. **Webhook**
   - Método: `POST`
   - Path: `boda-fotos`
   - Modo: producción (no "test")
   - "Binary Data" activado, para recibir el archivo tal cual.
2. **Google Drive → Upload**
   - Credencial OAuth2 de Drive (a conectar una vez en n8n con la cuenta de
     Google dueña/con acceso a la carpeta).
   - `Folder ID`: el de la carpeta compartida de destino.
   - Nombre de archivo: el original recibido, prefijado con timestamp para
     evitar colisiones (`{{$now}}_{{$binary.data.fileName}}`).
3. **Respond to Webhook**
   - Devuelve `{ "ok": true }` con status 200 en éxito.
   - Un nodo de error conectado a la rama de fallo del Drive node responde
     `{ "ok": false, "error": "..." }` con status 500.

El JSON exportable del workflow y los pasos de configuración de la
credencial de Drive se entregan aparte como archivo de import para n8n (no
se puede crear el workflow por API sin acceso a esa instancia).

**Requisito operativo importante**: el proxy inverso delante de n8n
(Coolify/Traefik) suele limitar el tamaño de body a 1 MB por defecto. Hay
que subir ese límite (`client_max_body_size` o el equivalente en la config
de Coolify/Traefik) a **80 MB**, para dar margen sobre el límite de 50 MB
que valida el frontend (ver más abajo) y permitir vídeos cortos de móvil.
Esto se documenta como paso manual de infraestructura, no es código.

### 2. Frontend (`index.html`)

- Añadir un `<input type="file" id="upload-input" multiple accept="image/*,video/*" style="display:none">` dentro del `qr-wrap`/sección.
- `handleUploadClick()` deja de hacer `alert()` de éxito: si `uploadActive`,
  dispara un click en `#upload-input`.
- Nuevo listener `change` en `#upload-input`:
  - Por cada archivo seleccionado, valida tamaño (límite: **50 MB**) y tipo
    (imagen o vídeo); si falla, feedback inline, no bloquea el resto.
  - Construye un `FormData` por archivo y hace `fetch(WEBHOOK_URL, {method:'POST', body: formData})`.
  - Actualiza `#upload-btn-label` con estado: "Subiendo 1/3…" →
    "¡Gracias, recibido!" (3s) → vuelve al texto original. Si algún archivo
    falla, "Hubo un problema, inténtalo de nuevo" en vez de bloquear el
    resto de subidas.
  - Sin barra de progreso granular (no es necesaria para este volumen de
    uso); basta con el estado por archivo.
- `WEBHOOK_URL` se define como constante al principio del bloque `<script>`
  (`https://n8n.TUDOMINIO/webhook/boda-fotos`), a rellenar con el dominio
  real antes de publicar.

### 3. QR real

- El SVG decorativo actual se sustituye por un QR generado en el propio
  navegador con un generador QR en JS puro autocontenido (sin dependencias
  externas ni CDN, para no romper el sitio 100% estático/offline-friendly).
- Codifica `https://TUDOMINIO/#recuerdos`.
- Se genera una sola vez al cargar la página (la URL es fija), pintado en
  un `<canvas>` o `<svg>` dentro de `#qr-wrap`, respetando el overlay de
  bloqueo (`is-locked`) que ya existe.

## Manejo de errores

- **Archivo demasiado grande / tipo no soportado**: se detecta en el
  cliente antes de subir, evita gastar banda y deja mensaje claro.
- **Fallo de red o webhook caído**: `fetch` en catch, mensaje "Hubo un
  problema, inténtalo de nuevo" — no se pierde el resto de la subida por
  un archivo fallido (subida por archivo, no atómica en batch).
- **n8n/Drive rechaza el archivo** (cuota de Drive, etc.): el nodo de error
  del workflow responde 500 con detalle; el frontend lo trata igual que un
  fallo de red genérico (no se expone el detalle interno al invitado).

## Testing

- Verificación manual: con `uploadActive` forzado a `true` temporalmente
  (o cambiando la fecha del sistema/el check), subir una imagen de prueba
  desde el navegador y confirmar que aparece en la carpeta de Drive.
- Verificar que el QR generado escanea correctamente con un móvil real y
  lleva a `#recuerdos`.
- Verificar que el límite de tamaño del proxy de n8n no corta subidas de
  vídeos cortos típicos de móvil (~20-40 MB).
- No hay tests automatizados (sitio estático sin framework de testing).

## Fuera de alcance

- Galería para que la pareja vea las fotos dentro del propio sitio (Drive
  ya cumple esa función).
- Moderación/aprobación de contenido antes de que aparezca en Drive.
- Autenticación de invitados o límite de subidas por persona.
- Página de subida separada (se descartó a favor de reusar `#recuerdos`).
