# Galería de fotos en vivo (sincronizada con Drive) — Diseño

Fecha: 2026-09-01

## Contexto

Ambas invitaciones (`invitacion-editorial` — Gloria & José, `invitación-dani-irene`
— Daniel & Irene) ya tienen un backend de subida de fotos/vídeos funcionando
(ver `docs/superpowers/specs/2026-08-26-qr-upload-backend-design.md` y la
réplica del mismo patrón para Daniel & Irene): un botón/QR en `#recuerdos`
sube archivos vía webhook de n8n a una carpeta de Google Drive dedicada por
boda.

Falta la otra mitad: una página donde los invitados vean, el mismo día de la
boda, las fotos y vídeos que se van subiendo — sin recargar, casi en tiempo
real — sin depender de que alguien entre a Google Drive directamente.

## Decisiones tomadas

- **Ubicación**: página nueva dedicada por invitación (`galeria.html`), no
  embebida en `index.html`.
- **Latencia de sincronización**: ~15-30s (polling), no push instantáneo —
  suficiente para el caso de uso y sin infraestructura nueva de websockets/SSE.
- **Moderación**: ninguna — todo lo subido aparece automáticamente.
- **Vídeos**: reproducibles directamente en la propia cuadrícula (embed),
  no solo miniatura enlazando a Drive.
- **Backend**: se reutiliza n8n (mismo patrón que la subida), sin backend
  propio nuevo ni claves de API de Google expuestas en el cliente.

## Arquitectura y flujo de datos

```
Invitado sube foto/vídeo (flujo YA existente)
        │
   Webhook subida → Google Drive (Upload) → [NUEVO] asegurar permiso
   "cualquiera con el enlace puede ver" → Respond OK
        │
        ▼
   Carpeta de Drive de la boda (ya existe, una por boda)
        │
        │  (polling cada ~20s desde el navegador)
        ▼
[NUEVO] Webhook de listado (GET) → Google Drive (List files in folder)
        → Respond JSON [{id, nombre, tipo, fechaCreación}, ...]
        │
        ▼
galeria.html (nueva página, una por invitación)
   - al cargar: pide la lista, pinta todo
   - cada 20s: vuelve a pedir, compara con lo ya pintado, antepone solo lo nuevo
   - fotos → <img src="drive.google.com/thumbnail?id=...">
   - vídeos → <iframe src="drive.google.com/file/d/.../preview"> en la propia cuadrícula
```

Dos piezas nuevas por boda (mismo patrón "un recurso dedicado por boda" que
ya se usa para la subida): un workflow n8n de listado, y una página
`galeria.html`. Una pieza compartida entre ambas bodas: un pequeño cambio en
cada workflow de subida existente para garantizar que los archivos son
visibles sin login.

## Componentes

### 1. Nuevo workflow n8n "Listar fotos" (uno por boda)

Tres nodos, mismo estilo que el workflow de subida:

1. **Webhook**
   - Método: `GET`.
   - Path dedicado por boda (ej. `boda-gloria-jose-galeria`,
     `boda-daniel-irene-galeria`), modo producción.
2. **Google Drive → List/Search**
   - Reutiliza la misma credencial OAuth2 de Drive ya conectada.
   - Filtra por el mismo `Folder ID` que ya usa el workflow de subida de
     esa boda.
   - Campos: `id, name, mimeType, createdTime, thumbnailLink`.
   - Orden: `createdTime` descendente (más reciente primero).
   - Sin paginación: para el volumen esperado en una boda no hace falta.
3. **Respond to Webhook**
   - Devuelve el array JSON directamente, `Content-Type: application/json`.
   - Sin rama de error separada: si Drive falla, se responde igualmente con
     el código de estado que dé n8n; el frontend lo trata como fallo de
     carga genérico (ver Manejo de errores).

### 2. Cambio en los workflows de subida ya existentes

Después del nodo "Google Drive → Upload" y antes de "Respond OK", se añade
un nodo **Google Drive → Share** (resource: File, operation: Share) con
`type: anyone`, `role: reader`, sobre el `id` del archivo recién subido.
Garantiza que `thumbnailLink` y el embed `/preview` funcionen para
cualquier invitado sin sesión de Google iniciada.

**A verificar antes de implementar este nodo**: es posible que ya funcione
sin él, si la carpeta ya está compartida como "cualquiera con el enlace" y
Drive propaga ese permiso a los archivos nuevos creados dentro. Se
comprueba subiendo un archivo de prueba y abriendo su `thumbnailLink` en
una ventana de incógnito. Si ya es visible, se omite este nodo.

### 3. Página de galería (`galeria.html`, una por invitación)

- **Bloqueo por fecha**: mismo patrón que ya existe
  (`uploadActive`/`recuerdosActive`) — antes del día de la boda muestra
  "Disponible el día de la boda" en vez de la cuadrícula; el enlace hacia
  esta página desde `#recuerdos` en `index.html` respeta el mismo bloqueo.
- **Estilo propio de cada sitio**: reutiliza la paleta y clases de botón ya
  establecidas en cada invitación (`.btn-gold` en Gloria&José, `.btn-line`
  en Daniel&Irene) — mismo criterio aplicado en `subir.html`.
- **Cuadrícula**: CSS grid responsive, tiles con `aspect-ratio` fijo y
  `object-fit: cover`.
  - Fotos: `<img src="https://drive.google.com/thumbnail?id=FILE_ID&sz=w800">`.
  - Vídeos: `<iframe src="https://drive.google.com/file/d/FILE_ID/preview">`
    embebido directamente en el tile, con controles nativos de Drive.
- **Lightbox**: al hacer click en una foto se amplía en un overlay a
  pantalla completa (JS vanilla, sin librerías externas). Los vídeos no
  necesitan lightbox porque ya son reproducibles en el tile.
- **Sincronización** (`js/gallery.js`, un archivo por sitio — mismo patrón
  que `js/upload.js`):
  - Al cargar: pide la lista al webhook de esa boda y pinta todo.
  - Cada ~20s: repite la petición, compara los `id` ya pintados contra los
    nuevos recibidos, y antepone solo los tiles que faltan (fade-in suave),
    sin recargar la página ni perder la posición de scroll.
  - Filtra defensivamente por `mimeType` (`image/*` o `video/*`) antes de
    renderizar.
  - El polling se pausa con `document.visibilitychange` cuando la pestaña
    no está visible, y se reanuda al volver.
- **Estado vacío**: "Aún no hay fotos… ¡sé el primero en compartir!" con
  enlace de vuelta a subir.
- **Estado de error**: si el fetch falla, aviso discreto "No se pudieron
  cargar las fotos, reintentando…"; sigue reintentando en el siguiente
  ciclo de polling sin bloquear la página.
- **Enlace desde `#recuerdos`**: botón/enlace "Ver Galería" junto al de
  subir, en `index.html` de cada sitio, con el mismo bloqueo por fecha.
- **Vuelta a la invitación**: enlace `← Volver a la invitación` con
  `?open=1`, igual que en `subir.html`.

## Manejo de errores y edge cases

- **Filtrado defensivo de tipo**: solo se renderizan entradas cuyo
  `mimeType` empiece por `image/` o `video/`.
- **Vídeo que no carga en el iframe**: enlace discreto "Abrir en Drive"
  como fallback sobre/bajo cada tile de vídeo.
- **Carga concurrente de muchos invitados**: cada poll es una llamada de
  listado a Drive vía n8n; con el volumen esperado en una boda (decenas de
  invitados, un poll cada ~20s durante unas horas) queda muy por debajo de
  cualquier cuota de la API de Drive — no hace falta caché ni limitación
  adicional.

## Fuera de alcance

- Moderación/aprobación de contenido antes de que aparezca en la galería.
- Paginación / infinite scroll.
- Descarga en bloque (zip) de todas las fotos.
- Comentarios o "me gusta" por foto.
- Notificaciones push cuando hay fotos nuevas.
- Sincronización instantánea (push/websockets) — se usa polling.

## Testing

Manual, sin framework — igual que el resto del sitio (sitio estático sin
suite de tests automatizados):

- Subir una foto y un vídeo de prueba y confirmar que aparecen en
  `galeria.html` dentro de ~20-30s sin recargar.
- Verificar el lightbox de fotos y que el vídeo se reproduce embebido con
  controles.
- Forzar temporalmente la fecha de bloqueo para comprobar el estado
  "disponible el día de la boda" y su desbloqueo.
- Comprobar el estado vacío (carpeta sin archivos) y el estado de error
  (desactivando temporalmente el workflow de listado en n8n).
- Confirmar en incógnito que las miniaturas/vídeos se ven sin sesión de
  Google iniciada (verificación del nodo de permisos de Drive).
