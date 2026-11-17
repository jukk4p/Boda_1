# Media service propio para Gloria & José — diseño

## Intención y por qué

`invitacion-editorial` (Gloria & José, boda 31 jul 2027) hoy sube fotos/vídeos
vía un workflow de n8n que escribe directo a Google Drive, y la galería
(`galeria.html`/`js/gallery.js`) embebe esos archivos con `<img>`/`<iframe>`
apuntando a URLs de Drive.

El proyecto hermano `bodad-i` (Daniel & Irene, boda ya celebrada 24 oct 2026)
resolvió esto con un servicio propio (`media-service`: Node/Express + ffmpeg,
sirviendo los archivos desde el propio dominio) con panel de borrado admin,
verificado en producción. El usuario quiere ese mismo stack para Gloria &
José, no el basado en Drive.

**Por qué ahora:** durante la boda de Daniel & Irene hubo dos problemas con
la subida de vídeos: (1) un límite de tamaño demasiado estricto (bug ya
corregido ahí, 50MB→500MB) y (2) cobertura de red floja en el lugar del
evento, que el usuario solo identificó después. Como la boda de Gloria & José
es en jul 2027, hay tiempo de sobra para construir una versión mejorada en
vez de solo clonar el stack actual.

## Objetivos

- Mismo stack funcional que `bodad-i`: subida con transcodificación de
  vídeo, galería en vivo servida desde dominio propio, panel de borrado
  admin con Basic Auth.
- Mejoras sobre `bodad-i` (acordadas con el usuario, ver Enfoques):
  - **(A)** Progreso real de subida (no solo "Subiendo X/Y") + reintento
    automático ante fallos de red, sin reiniciar el archivo desde cero.
  - **(B)** Soporte HEIC/HEIF (fotos "Alta eficiencia" de iPhone) — gap real
    de `bodad-i`, no solo mejora cosmética.
  - **(C)** Backup automático fuera del VPS (reutilizando la credencial de
    Google Drive OAuth2 ya conectada en n8n para esta pareja, como copia de
    seguridad silenciosa — no como origen de verdad de la galería ni para el
    embed).
  - **(D)** Remux sin recodificar cuando el vídeo original ya es compatible
    (H.264/AAC, resolución razonable), para no gastar CPU de más en el VPS
    compartido.
  - **(E)** Subida por chunks reanudable: si se corta la conexión a mitad de
    un vídeo grande, retomar desde el último chunk confirmado en vez de
    reiniciar el archivo completo — la mitigación más directa contra la
    cobertura floja que causó el problema en Daniel & Irene.

## No-objetivos

- No migrar las fotos/vídeos que ya existen en la Drive de Gloria & José —
  este diseño es para el flujo de subida nuevo a partir de que se despliegue.
- No tocar el proyecto `bodad-i` ni su `media-service` en producción (el
  usuario lo va a borrar de Coolify por su cuenta).
- No añadir autenticación/moderación al webhook público de subida — mismo
  riesgo aceptado que ya documentó el `README-setup.md` de Drive (mitigación
  operativa: mantener el workflow desactivado hasta cerca de la boda).
- No construir un dashboard de métricas/observabilidad nuevo.

## Anti-objetivos (que harían esto un fracaso aunque "funcione")

- Que un invitado con iPhone en modo "Alta eficiencia" no pueda subir una
  foto (regresión respecto a lo que debería cubrir B).
  Nota: la comprobación de B es directo-pero-crítica; HEIC también se
  acepta de no venir en "Alta eficiencia" si Apple ya la convierte a JPEG
  en el propio picker, así que el fallo real a evitar es cuando SÍ llega
  como HEIC nativo.
- Que una subida grande se corte por mala cobertura y el invitado tenga que
  reintentar el archivo entero desde cero (eso es exactamente lo que E debe
  evitar).
- Que el backup automático (C) se vuelva una segunda fuente de verdad o
  reintroduzca los problemas de embed de Drive documentados en
  `project_gallery_video_embed` — debe ser estrictamente de solo-escritura,
  nunca leído por la galería ni por el admin.

## Restricciones

- VPS compartido (Coolify, ~10 servicios incluyendo n8n/Postgres) — el
  limitador de concurrencia de ffmpeg de `bodad-i` (`concurrencyLimit.js`)
  se mantiene igual.
- Repo separado (`Boda_1` / `invitacion-editorial`), con su propio dominio
  de producción: `https://bodagloriayjose.ivangonzalez.cloud/`. El nuevo
  `media-service` sirve bajo `https://bodagloriayjose.ivangonzalez.cloud/uploads/`,
  mismo patrón que `bodadaniyirene.ivangonzalez.cloud/uploads`.
- Credencial de Basic Auth para el panel admin ya existe (n8n, usuario
  `gyj2027`) — reutilizar, no crear una nueva.
- Credencial de Google Drive OAuth2 ya conectada en n8n para esta pareja
  (usada hoy por el workflow de subida) — reutilizar solo para (C), no para
  servir la galería.
- Sin urgencia de fecha (boda jul 2027): priorizar que quede bien hecho
  sobre entregar rápido.

## Enfoques considerados

**Migración (decidido con el usuario en la conversación):**
1. Reemplazar Drive por completo con `media-service` propio — **elegido**.
2. Mantener Drive, portar solo el panel de borrado — descartado (no resuelve
   las fricciones de Drive que motivaron el cambio).
3. Híbrido media-service + copia a Drive en paralelo — la idea de (C) la
   recoge sin la complejidad de mantener Drive como ruta de subida.

**Mejoras sobre el stack de `bodad-i` (A–E, todas aceptadas por el usuario):**
ver Objetivos. Se consideró explícitamente dejar (E) afuera por ser la pieza
más grande, pero el usuario pidió incluirla — dado el tiempo disponible
hasta la boda, se acepta el alcance mayor.

## Decisiones ya tomadas

- Dominio del nuevo servicio: `bodagloriayjose.ivangonzalez.cloud/uploads`
  (confirmado por el usuario — mismo dominio que el sitio, no subdominio
  propio, menos piezas de DNS/certificados que mantener).
- Backup (C) usa la credencial Drive OAuth2 ya conectada de esta pareja,
  en modo solo-escritura (mi propuesta — the usuario puede pedir otro
  destino, ej. S3, si prefiere no depender de Drive ni para esto).
- Base del código: fork de `media-service` de `bodad-i` (mismo
  Dockerfile, mismo `id.js`/`manifest.js`/`concurrencyLimit.js` sin
  cambios), no una reescritura desde cero.

## Decisiones añadidas tras la revisión del diseño

- **Subida directa a `media-service`, no a través de n8n.** `bodad-i` hace
  pasar incluso la subida por el webhook de n8n (que reenvía a
  `media-service`), pero n8n bufferea la petición completa antes de invocar
  el workflow — eso rompe tanto el progreso real (A) como los chunks
  reanudables (E), que necesitan una conexión directa y streameable. Acá el
  cliente sube directo a `media-service` (incluido `/upload/chunk`); n8n
  queda solo para: listado de galería, disparo del backup periódico (C) y
  el proxy de borrado con Basic Auth (mismo rol que ya tiene en `bodad-i`).
  Esto implica enrutar `/upload*` y `/uploads/*` en Coolify/nginx hacia el
  contenedor de `media-service` en `bodagloriayjose.ivangonzalez.cloud`,
  igual que ya existe para `/uploads/*` en `bodadaniyirene`.
- **Backup (C): solo originales, disparado por n8n con Scheduled Trigger.**
  Los derivados (grid/poster/mp4 transcodificado) no se respaldan — se
  pueden regenerar desde el original con el mismo código. La credencial
  Drive OAuth2 vive solo dentro de n8n (nunca se le da a `media-service`):
  un workflow con **Scheduled Trigger** llama a un nuevo endpoint
  `GET /unbacked` de `media-service` (ids sin respaldar), descarga cada
  original, lo sube a Drive con el nodo Google Drive de n8n, y llama a
  `POST /backed/:id` para marcarlo. `manifest.js` necesita un campo nuevo
  (`backedUpAt` o similar) por item.
- **Limpieza de sesiones de chunks abandonadas (E).** Un invitado que cierra
  la pestaña a mitad de una subida deja chunks sueltos en disco — en un VPS
  compartido eso puede llenar el disco en silencio. TTL de 24-48h sobre
  directorios de sesión incompletos, barrido por el mismo mecanismo
  periódico que dispara el backup (mismo Scheduled Trigger de n8n, o un
  `setInterval` dentro de `media-service`).

## Lo que queda para quien lo construya

- **Riesgo técnico a verificar primero (B):** confirmar si `apk add ffmpeg`
  en la imagen `node:20-alpine` decodifica HEIC/HEIF nativamente. No quedó
  confirmado en la investigación (ver hallazgos de esta conversación) — si
  no lo soporta, evaluar añadir `libheif`/`libheif-dev` al Dockerfile o un
  paso de conversión previo. Esto bloquea (B) y debe resolverse antes de
  prometer el soporte HEIC como terminado.
- Diseñar el esquema de chunks de (E): tamaño de chunk, endpoint
  `POST /upload/chunk` (uploadId, chunkIndex, totalChunks), cómo el cliente
  recuerda qué chunks ya confirmó el servidor si se recarga la página
  (localStorage keyed por hash/tamaño/lastModified del archivo), e
  idempotencia en el servidor ante chunks reenviados.
- Definir umbral exacto para el remux sin recodificar de (D): qué códec/
  bitrate/resolución de origen califica como "ya compatible" antes de
  decidir copiar en vez de recodificar con libx264.
- Reescribir `js/upload.js` (XHR con progreso + reintento + chunks) y
  `js/gallery.js` (consumir el formato de `media-service` — `id/url/
  gridUrl/posterUrl` — y reemplazar el iframe/vignette de Drive por
  `<video>` nativo, ya no hace falta el hack documentado en
  `project_gallery_video_embed`).
- Crear `admin.html` en `invitacion-editorial` (puerto del de `bodad-i`),
  apuntando al nuevo endpoint de borrado.
- Nuevo recurso Coolify para el `media-service` clonado, nuevo workflow n8n
  que reemplaza el de Drive (reenvía a `media-service`) + uno nuevo para el
  backup periódico a Drive (C) + uno de borrado con Basic Auth (como el de
  `bodad-i`).
- Decidir y documentar en el propio workflow la ventana de activación del
  webhook (desactivado hasta cerca de la boda), igual que ya hace el
  `README-setup.md` actual de Drive.
