# Formularios de Asistencia y Alergias + Dashboard admin (n8n)

## Contexto

`invitacion-editorial` (repo `Boda_1`) es un sitio estático (HTML/CSS/JS, sin backend propio) desplegado en Coolify. Ya usa un n8n self-hosted (`https://n8n.ivangonzalez.cloud`) como webhook de subida de fotos (`js/upload.js` → `POST /webhook/boda-fotos`).

Actualmente las secciones "Confirmar Asistencia" (`#confirmar`) y "Alergias e Intolerancias" (`#alergias`) en `index.html` son solo botones de WhatsApp (`wa.me` deep links a Gloria y José), sin persistencia de datos en ningún sitio consultable.

Objetivo: sustituir esas dos secciones por formularios reales que guarden las respuestas, y dar acceso a un dashboard con usuario/contraseña para consultarlas — todo temporal (se borra a los pocos días de la boda, 31/07/2027) y sin añadir servicios de terceros nuevos, reutilizando el n8n que ya tienen.

## Decisiones tomadas

- **Backend**: se extiende el n8n existente con 2 webhooks POST (uno por formulario) + 1 webhook GET protegido con Basic Auth nativo de n8n para el dashboard. No se crea ningún servicio, base de datos ni cuenta nueva.
- **Almacenamiento**: archivos `.jsonl` (una línea JSON por envío) en el disco del contenedor de n8n, escritos con el nodo nativo "Read/Write Files from Disk" (disponible en cualquier versión de n8n), en vez del nodo "Data Table" (demasiado reciente, versión de n8n del usuario desconocida).
- **UI**: el formulario es el método principal en ambas secciones; se conserva un enlace de WhatsApp más pequeño debajo, como alternativa para quien no confíe en el formulario.
- **Auth del dashboard**: credencial Basic Auth de n8n, usuario `gyj2027` / una contraseña elegida por el usuario al crear la credencial en n8n (no se documenta en texto plano en el repo) (los secretos de credenciales no viajan en el JSON exportado de un workflow).
- **Entrega del workflow**: como no hay acceso directo (API/MCP) a la instancia de n8n del usuario desde esta sesión, el workflow se entrega como JSON importable manualmente en la UI de n8n, con instrucciones de verificación post-import (rutas de archivo, credencial).

## Modelo de datos

### RSVP (`boda-rsvp.jsonl`, una línea por envío)

```json
{
  "timestamp": "2026-08-29T18:00:00.000Z",
  "nombre": "Juan Pérez",
  "asiste": true,
  "acompanantes": 2,
  "nombres_acompanantes": ["María Pérez", "Luis Pérez"]
}
```

- `nombre` (string, requerido): quien confirma.
- `asiste` (boolean, requerido).
- `acompanantes` (number, ≥0): total de acompañantes (sin contar a quien confirma). Si `asiste` es `false`, se envía `0` y `nombres_acompanantes` vacío.
- `nombres_acompanantes` (array de strings): un input de texto por acompañante, generado dinámicamente en el front-end según el número indicado.

### Alergias (`boda-alergenos.jsonl`, una línea por envío)

```json
{
  "timestamp": "2026-08-29T18:00:00.000Z",
  "nombre_persona": "María Pérez",
  "tipos": ["Gluten", "Frutos secos"],
  "detalle": "alergia severa a nueces, evitar trazas"
}
```

- `nombre_persona` (string, requerido): puede ser el propio invitado o un acompañante.
- `tipos` (array de strings): checkboxes de opciones comunes — Gluten, Lactosa, Frutos secos, Marisco/Pescado, Huevo, Otros.
- `detalle` (string, opcional): texto libre, obligatorio solo si se marca "Otros".

## Arquitectura

```
[index.html forms] --fetch POST JSON--> [n8n Webhook POST /boda-rsvp]      --> append línea --> boda-rsvp.jsonl
[index.html forms] --fetch POST JSON--> [n8n Webhook POST /boda-alergenos] --> append línea --> boda-alergenos.jsonl

[navegador admin] --GET + Basic Auth--> [n8n Webhook GET /boda-admin] --> lee ambos .jsonl --> arma HTML --> responde tabla
```

### Workflow n8n ("Boda - Formularios")

Un único workflow con 3 ramas independientes (3 disparadores):

1. **Rama RSVP**: `Webhook (POST, path=boda-rsvp, CORS: Allowed Origins=*)` → `Code` (añade `timestamp`, construye la línea JSON) → `Move Binary Data` (JSON→binario, raw data) → `Read/Write Files from Disk` (operación *write*, modo *append*, ruta `/data/boda-rsvp.jsonl`) → `Respond to Webhook` (200, `{"ok":true}`).
2. **Rama Alergias**: igual que la anterior, path `boda-alergenos`, archivo `/data/boda-alergenos.jsonl`.
3. **Rama Admin**: `Webhook (GET, path=boda-admin, Authentication=Basic Auth, credencial "Boda Admin Auth")` → `Read/Write Files from Disk` (read, `/data/boda-rsvp.jsonl`) → `Read/Write Files from Disk` (read, `/data/boda-alergenos.jsonl`, encadenado en serie tras el anterior) → `Code` (lee ambos vía `$('Leer RSVP')`/`$('Leer Alergias')`, decodifica el binario, parsea ambos JSONL, genera HTML con dos tablas, estilo dorado/verde acorde a la web, y muestra un aviso si la lectura de algún archivo falló) → `Respond to Webhook` (200, `Content-Type: text/html`).

Nota de despliegue: `/data/` es una ruta de ejemplo — el usuario debe verificar cuál es el directorio de trabajo escribible/persistente de su contenedor de n8n (habitualmente algo bajo el volumen montado de n8n) y ajustar la ruta en los 4 nodos "Read/Write Files from Disk" tras importar.

### Cambios en `index.html`

- Sección `#confirmar`: sustituir los dos `<a class="btn-whatsapp">` por un `<form>` con: input nombre, radio/select asiste sí/no, input numérico acompañantes (revela N inputs de texto dinámicamente vía JS al cambiar), botón enviar. Debajo del formulario, enlace de texto pequeño "¿Prefieres avisarnos por WhatsApp?" con los dos `wa.me` links actuales en formato compacto (no botones grandes).
- Sección `#alergias`: sustituir por `<form>` con: input nombre de la persona, checkboxes de tipos comunes, textarea detalle (obligatorio si "Otros" marcado), botón enviar. Mismo enlace pequeño de WhatsApp debajo.
- Mensajes de éxito/error inline bajo cada formulario (reemplazando el texto del botón, igual que hace `upload.js` con `btnLabel`).

### `js/forms.js` (nuevo)

Módulo compartido, mismo estilo que `js/upload.js`:
- `initRsvpForm({ formId, webhookUrl })`: valida, construye el JSON, `fetch POST`, deshabilita el botón mientras envía, muestra estado de éxito/error, re-habilita tras unos segundos.
- `initAlergenosForm({ formId, webhookUrl })`: idem, con su propia validación (nombre y al menos un tipo o detalle).
- Ambos con `AbortSignal.timeout(...)` como ya hace `upload.js`, y sin bloquear el formulario si la petición falla (el usuario puede reintentar o usar el enlace de WhatsApp).

## Manejo de errores

- Front-end: si `fetch` falla o el webhook responde con error, se muestra "Hubo un problema, inténtalo de nuevo o escríbenos por WhatsApp" sin borrar lo escrito en el formulario.
- n8n: si el archivo `.jsonl` no existe aún, el nodo de escritura en modo *append* lo crea; si el de lectura (rama admin) falla porque el archivo no existe todavía (cero envíos), el `Code` node debe tratarlo como lista vacía en vez de fallar.

## Testing

- Front-end: verificación manual en navegador (servidor local `python -m http.server` + claude-in-chrome) de ambos formularios — validación de campos, aparición/desaparición de inputs de acompañantes, estados de éxito y error simulado (URL de webhook inválida temporalmente).
- n8n: no ejecutable desde esta sesión (sin acceso a la instancia); el usuario deberá importar el workflow, ajustar rutas de archivo, crear la credencial Basic Auth, y probar con un envío real desde el formulario y una carga del dashboard.

## Riesgos / limitaciones conocidas

- El JSON del workflow se entrega sin poder probarse contra la instancia real de n8n del usuario; puede requerir ajustes menores de parámetros según su versión exacta de n8n.
- Escritura concurrente en el mismo archivo `.jsonl` por dos envíos simultáneos es técnicamente posible (condición de carrera) pero de riesgo despreciable dado el volumen esperado (invitados de una boda, no tráfico masivo).
- Nada de esto está pensado para durar más allá de la boda; no se implementa backup, migración de datos ni escalabilidad.
