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

> **Nota:** el candado `uploadActive` del frontend bloquea la subida en el
> navegador hasta el día de la boda, pero el webhook de n8n en sí no tiene
> ningún control de fechas — una vez activado queda como endpoint público
> y sin autenticación durante los ~11 meses hasta la boda. Como el
> proyecto deja fuera de alcance añadir autenticación/moderación, la
> mitigación gratuita es operativa: una vez termines de configurar y
> probar el workflow, vuelve a desactivarlo (interruptor "Active" en
> off) y actívalo de nuevo solo cerca de la fecha de la boda.

## 4. Subir el límite de tamaño de body en el proxy

Coolify pone n8n detrás de Traefik. Por defecto Traefik no limita el
tamaño del body, pero si tu instancia sí lo hace (o si ves errores 413 al
subir vídeos), añade en Coolify, en la configuración del recurso de n8n,
en el campo de "Custom Traefik Labels" (o equivalente en tu versión de
Coolify):

```
traefik.http.middlewares.n8n-bodylimit.buffering.maxRequestBodyBytes=83886080
traefik.http.routers.<nombre-del-router-de-n8n>.middlewares=n8n-bodylimit
```

Sustituye `<nombre-del-router-de-n8n>` por el nombre real del router que
Coolify haya generado para el servicio de n8n (visible en la config
generada del recurso). 83886080 bytes = 80 MB.

## 5. Prueba de humo

```bash
curl -F "data=@/ruta/a/una/foto.jpg" https://TU_WEBHOOK_URL
```

Expected: la respuesta es `{"ok":true}` y la foto aparece en la carpeta
de Drive en menos de un minuto.

**Importante:** este `curl` no valida CORS — se ejecuta desde tu terminal,
no desde el dominio del sitio, así que puede devolver éxito aunque el
navegador lo rechace. Para comprobar CORS hace falta probar desde un
navegador o móvil real, cargando la web en su dominio de producción y
subiendo un archivo desde ahí. Si esa prueba en el navegador muestra
"Hubo un problema" pero el archivo sí aparece en Drive, la causa más
probable es CORS: revisa la opción "Allowed Origins (CORS)" del nodo
**Webhook** y asegúrate de que incluye el dominio real del sitio (o usa
`*`). El mismo desajuste silencioso —éxito real en Drive, error visible
para el invitado— puede darse con un 413 de Traefik (body demasiado
grande, ver sección 4): tampoco lleva cabeceras CORS y, desde el
navegador, es indistinguible de un fallo de CORS.
