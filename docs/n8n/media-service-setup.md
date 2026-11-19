# Configurar los workflows de n8n para el media-service propio

Reemplaza la sección de Drive de `README-setup.md` para la parte de
galería/subida de fotos y vídeos. Los formularios de RSVP/alérgenos no
cambian — siguen su propio workflow, documentado aparte.

**Estado:** los 3 workflows de abajo ya están creados, configurados y
publicados en producción (`n8n.ivangonzalez.cloud`), y el workflow viejo de
subida directa a Drive ya está desactivado. Las pruebas de humo completas
(que el listado devuelva datos reales, que el borrado funcione contra un
id real, que el backup suba un archivo real a Drive) están **pendientes de
la Task 13** — el dominio `bodagloriayjose.ivangonzalez.cloud` aún no tiene
el `media-service` desplegado detrás, así que hoy devuelve un 404 genérico
de nginx para cualquier ruta. Lo que sí se verificó ya, sin depender del
despliegue: la forma de cada workflow (nodos, modos Expression, Basic Auth)
es correcta, y el gate de autenticación del workflow de borrado responde
tal como se espera (ver la sección de cada workflow).

El media-service propio (`media-service/`, desplegado en Coolify — ver la
sección final de este documento) reemplaza la subida directa a Google
Drive. n8n pasa a tener tres funciones nada más:

1. Listar la galería (proxy de solo lectura a `GET /list`).
2. Hacer backup periódico de los originales a Drive (Scheduled Trigger).
3. Borrar un ítem, protegido con Basic Auth (proxy a `DELETE /items/:id`).

## Workflow 1 — "Boda Gloria & José - Listado de galería"

**Qué hace:** `GET /webhook/boda-gj-galeria` → reenvía a
`GET https://bodagloriayjose.ivangonzalez.cloud/list` → devuelve el JSON
tal cual al que pregunta (lo consumen `js/gallery.js` y `admin.html`).

1. En n8n: **Workflows → Add workflow**, nómbralo
   `Boda Gloria & José - Listado de galería`.
2. Nodo **Webhook**:
   - HTTP Method: `GET`
   - Path: `boda-gj-galeria`
   - Authentication: `None` (es un listado público, igual que el resto de
     la galería)
   - Respond: `Using 'Respond to Webhook' Node`
3. Nodo **HTTP Request** (conectado a la salida del Webhook):
   - Method: `GET`
   - URL: `https://bodagloriayjose.ivangonzalez.cloud/list`
   - **Activa "Include Response Headers and Status".** En la versión actual
     de n8n (2.10.2) esta opción no aparece directamente en el menú
     "Add option" — hay que elegir primero **Response** (que añade un
     sub-panel), y **dentro** de ese sub-panel aparece el toggle "Include
     Response Headers and Status". Esto es importante — sin esto, el
     siguiente nodo puede reenviar el cuerpo en el formato equivocado
     cuando la lista está vacía (ver la nota más abajo).
4. Nodo **Respond to Webhook**:
   - Respond With: `JSON`
   - Response Body (modo **Expression**, no texto fijo):
     `{{ $json.body }}`

> **Gotcha ya encontrado en el proyecto hermano (Daniel & Irene):** con
> una configuración más simple (sin "Include Response Headers and Status"
> + "Respond to Webhook (All Incoming Items)"), cuando la galería tiene
> **cero ítems** n8n no genera ningún item de salida del HTTP Request, así
> que el webhook responde con el **cuerpo completamente vacío** en vez de
> `[]`. Eso rompería `galeria.html` para los primeros invitados, antes de
> que se suba la primera foto. La combinación de arriba (Include Response
> Headers and Status + `Respond With: JSON` → `{{ $json.body }}` en modo
> Expression) ya se verificó que lo soluciona en producción para el otro
> proyecto — replicar exactamente esa combinación aquí.

5. Activa el workflow (interruptor "Active").
6. Copia la **Production URL** del nodo Webhook — debe coincidir con
   `https://n8n.ivangonzalez.cloud/webhook/boda-gj-galeria`, que es el
   valor que ya están usando `js/gallery.js` (`GALLERY_LIST_URL`) y
   `admin.html` (`LIST_WEBHOOK_URL`).

**Smoke test:**

```bash
curl https://n8n.ivangonzalez.cloud/webhook/boda-gj-galeria
```

Esperado: `[]` (si la galería real está vacía) o un array JSON de ítems —
nunca un cuerpo vacío ni un error.

**Resultado real (19 nov, antes de Task 13):** el workflow en sí está bien
configurado (Webhook → HTTP Request con headers incluidos → Respond to
Webhook con `{{ $json.body }}`), pero el `curl` de arriba hoy devuelve
cuerpo vacío — no por el bug de "cero ítems" que describe la nota, sino
porque `https://bodagloriayjose.ivangonzalez.cloud/list` todavía responde
con un 404 genérico de nginx (el `media-service` no está desplegado ahí
todavía). Repetir este smoke test después de la Task 13.

## Workflow 2 — "Boda Gloria & José - Backup a Drive"

**Qué hace:** cada día a las 4am, busca los originales que `media-service`
aún no ha respaldado y los sube a la carpeta de Drive ya conectada para
esta pareja. 5 nodos en cadena — **no hace falta un nodo "Split in
Batches"/Loop**: n8n ya ejecuta cada nodo normal una vez por cada ítem de
entrada automáticamente, así que los 3 nodos entre el listado y el marcado
final corren uno por ítem sin configuración extra.

1. Nodo **Schedule Trigger**: Interval → `Days`, Trigger at Hour → `4am`.
2. Nodo **HTTP Request**, renombrado **"Buscar pendientes"**:
   - Method: `GET`
   - URL: `https://bodagloriayjose.ivangonzalez.cloud/unbacked`
   - Devuelve `[{ id, originalExt }, ...]`.
3. Nodo **HTTP Request**, renombrado **"Descargar original"**:
   - Method: `GET`
   - URL (**modo Expression**):
     `https://bodagloriayjose.ivangonzalez.cloud/uploads/originals/{{ $json.id }}.{{ $json.originalExt }}`
   - **Options → Response → Response Format: `File`** (no "Autodetect") —
     esto es lo que hace que el cuerpo de la respuesta se guarde como
     binario en el campo `data` de la salida, en vez de intentar
     parsearlo como JSON/texto. "Put Output in Field" queda en `data`
     (el valor por defecto), que es justo el nombre que el nodo Google
     Drive espera a continuación.
4. Nodo **Google Drive → Upload file**:
   - Credential to connect with: **"Google Drive account"** — en esta
     instancia de n8n solo existe esa credencial (compartida entre Daniel
     & Irene y Gloria & José), seleccionada por defecto al crear el nodo;
     no hace falta tocarla.
   - Input Data Field Name: `data` (ya viene así por defecto, coincide con
     el nodo anterior).
   - File Name (**modo Expression**): `{{ $json.id }}.{{ $json.originalExt }}`
   - Parent Drive: `From list` → `My Drive` (igual que el workflow viejo
     de subida).
   - Parent Folder: **`By ID`** → `1Pl4S9s1uf0jDqV5Vkgrsp_PAYNpMou3l` — es
     el mismo Folder ID que ya usa `"Boda Gloria & José - Subida de fotos
     a Drive"` (cópialo de ese workflow, nodo Google Drive, campo "Parent
     Folder", si necesitas volver a confirmarlo).

   > **Nota de accesibilidad/automatización:** el desplegable "Mode..." de
   > Parent Folder (el que cambia entre "From list"/"By URL"/"By ID") no
   > siempre responde bien a clics automatizados — si te pasa lo mismo
   > manualmente no debería ocurrir, pero si alguna vez se vuelve a
   > automatizar esta configuración, puede hacer falta hacerlo a mano.

5. Nodo **HTTP Request**, renombrado **"Marcar respaldado"**:
   - Method: `POST`
   - URL (**modo Expression** — igual que el workflow de borrado, ver su
     gotcha más abajo):
     `https://bodagloriayjose.ivangonzalez.cloud/backed/{{ $('Buscar pendientes').item.json.id }}`

     **Importante:** usa `$('Buscar pendientes').item.json.id`, **no**
     `$json.id`. El nodo Google Drive (paso anterior) reemplaza el JSON
     del ítem con los metadatos del archivo que devuelve la API de Drive
     — que también tiene un campo `id` (el id del archivo en Drive, no el
     id del ítem en `media-service`). Usar `$json.id` aquí marcaría como
     respaldado un id equivocado (el de Drive), y `POST /backed/:id`
     fallaría en silencio contra un id que no existe en `media-service`.
     La referencia explícita al nodo `"Buscar pendientes"` evita ese
     problema sin importar qué devuelva Google Drive.
6. Activa el workflow.

**Smoke test:** sube una foto de prueba real (vía `subir.html` o
directamente con `curl -F "data=@foto.jpg" https://bodagloriayjose.ivangonzalez.cloud/upload`),
espera a que `GET /unbacked` la liste, ejecuta el workflow manualmente
("Execute workflow" en n8n) y confirma: (a) la foto aparece en la carpeta
de Drive, y (b) `GET /unbacked` deja de listarla después (gracias a
`POST /backed/:id`).

**Pendiente (Task 13):** no se pudo ejecutar este smoke test todavía — sin
`media-service` desplegado no hay ningún ítem real en `/unbacked` para
probar. El workflow está construido y publicado, listo para probarse en
cuanto el backend esté en producción.

## Workflow 3 — "Boda Gloria & José - Borrar de galería"

**Qué hace:** `POST /webhook/boda-gj-borrar`, protegido con Basic Auth
(usuario `gyj2027`, credencial **ya existente** en n8n — no crear otra),
reenvía a `DELETE https://bodagloriayjose.ivangonzalez.cloud/items/:id`.

1. Nodo **Webhook**:
   - HTTP Method: `POST`
   - Path: `boda-gj-borrar`
   - Authentication: `Basic Auth`
   - Credential: **"Boda Admin Auth"** (usuario `gyj2027`) — ya existe en
     n8n, reutilizar, no crear una nueva. **Cuidado al crear el nodo**: el
     desplegable de credencial puede proponer por defecto "Boda D&I -
     Admin Auth" (la del proyecto hermano, Daniel & Irene) si esa fue la
     credencial usada más recientemente en la instancia — verifica que
     dice "Boda Admin Auth" a secas, sin "D&I", antes de seguir.
   - Respond: `Using 'Respond to Webhook' Node`
2. Nodo **HTTP Request** ("Borrar en media-service"):
   - Method: `DELETE`
   - URL (**modo Expression, no texto fijo**):
     `=https://bodagloriayjose.ivangonzalez.cloud/items/{{ $json.body.id }}`

   > **Gotcha ya encontrado en el proyecto hermano:** si el campo URL
   > queda en modo "Fixed" con `{{ }}` escritas a mano dentro de un texto
   > normal, n8n **no las evalúa** — envía la cadena literal
   > `{{ $json.body.id }}` como si fuera el id, y el borrado falla
   > silenciosamente (404 desde `media-service`, porque ese id no existe).
   > Tiene que estar en **modo Expression** (el icono de la "fx" junto al
   > campo, fondo morado/resaltado) para que `$json.body.id` se sustituya
   > de verdad por el id real que mandó `admin.html` en el cuerpo del
   > POST.
   - Options → "Include Response Headers and Status": activarlo también
     aquí, por consistencia con el workflow 1.
3. Nodo **Respond to Webhook**:
   - Respond With: `JSON`
   - Response Body (modo Expression): `{{ $json.body }}`
4. Activa el workflow.

**Smoke test:**

```bash
# Credenciales incorrectas -> 401/403
curl -i -X POST https://n8n.ivangonzalez.cloud/webhook/boda-gj-borrar \
  -u wronguser:wrongpass \
  -H "Content-Type: application/json" \
  -d '{"id":"0_00000000000000000000000000000000"}'

# Credenciales correctas, id inexistente -> debería llegar hasta
# media-service y devolver 404 (no 401/403) -- confirma que la cadena
# completa (n8n -> media-service) funciona, aunque el id de prueba no
# exista de verdad
curl -i -X POST https://n8n.ivangonzalez.cloud/webhook/boda-gj-borrar \
  -u gyj2027:LA_CONTRASEÑA_REAL \
  -H "Content-Type: application/json" \
  -d '{"id":"0_00000000000000000000000000000000"}'
```

Para una prueba completa de verdad: sube una foto de prueba, cópiale el
`id` real desde `GET /list`, y repite el segundo `curl` con ese id — debe
devolver éxito y la foto debe desaparecer de `GET /list`.

**Resultado real (19 nov, antes de Task 13):**

```
$ curl -i -X POST .../webhook/boda-gj-borrar -u wronguser:wrongpass ...
HTTP/1.1 403 Forbidden

$ curl -i -X POST .../webhook/boda-gj-borrar -u gyj2027:<real> ...
HTTP/1.1 200 OK
```

El gate de Basic Auth funciona correctamente (credenciales malas →
rechazado antes de llegar a ningún nodo del workflow). La petición con
credenciales buenas devuelve `200` en vez del `404` esperado porque
`media-service` no está desplegado todavía (mismo motivo que el Workflow
1) — el nodo Respond to Webhook de este workflow no reenvía el código de
estado HTTP de `media-service`, solo el cuerpo (igual que el patrón ya
verificado en producción en el workflow hermano de Daniel & Irene), así
que un 404/200 de `media-service` llega siempre como `200` al que llamó al
webhook; lo que importa es el contenido del cuerpo, que `admin.html` no
inspecciona para decidir éxito/error en este flujo. Repetir la prueba
completa (con un id real) después de la Task 13.

## Desactivar el workflow viejo

El workflow de subida directa a Drive (`"Boda Gloria & José - Subida de
fotos a Drive"`) ya no se usa — `js/upload.js` ahora sube directo a
`media-service`. **Ya está desactivado** (Unpublish, 19 nov) — no se borró,
por si hiciera falta revertir antes de la boda. El workflow viejo de
listado (`"Boda Gloria & José - Listado de fotos"`, vía Drive) se dejó
activo deliberadamente por ahora — ya no lo consume nada en el sitio
(tanto `js/gallery.js` como `admin.html` usan el nuevo `boda-gj-galeria`),
pero no formaba parte del alcance explícito de esta tarea; se puede
desactivar en una pasada de limpieza posterior si se confirma que nada más
lo usa.

## Despliegue en Coolify

*(Se completa en la Task 13 de este mismo plan — pendiente.)*
