# Configurar el workflow "Boda - Formularios" en n8n

Este workflow no se puede probar desde fuera de tu instancia de n8n, así que
tras importarlo hay que verificarlo a mano. Pasos:

## 1. Importar

En `https://n8n.ivangonzalez.cloud`: Workflows → botón "Import from File" (o
"..." → Import from File/URL) → selecciona `boda-formularios.workflow.json`.

## 2. Comprobar la ruta de archivos

El workflow trae por defecto `/data/boda-rsvp.jsonl` y `/data/boda-alergenos.jsonl`,
que casi seguro NO existen en tu contenedor. **En esta instancia
(`n8n.ivangonzalez.cloud`) ya está resuelto** con la ruta real:

```
/home/node/.n8n/boda-datos/boda-rsvp.jsonl
/home/node/.n8n/boda-datos/boda-alergenos.jsonl
```

`/home/node/.n8n` es el único volumen persistente de este n8n (verificado en
Coolify → N8N → Persistent Storages). Pero n8n bloquea por defecto que el nodo
"Read/Write Files from Disk" escriba dentro de su propia carpeta de datos, así
que hicieron falta dos variables de entorno nuevas en el servicio N8N de
Coolify (Configuration → Environment Variables):

- `N8N_RESTRICT_FILE_ACCESS_TO=/home/node/.n8n/boda-datos`
- `N8N_BLOCK_FILE_ACCESS_TO_N8N_FILES=false`

(hay que reiniciar el servicio tras añadirlas para que se apliquen), y crear a
mano la carpeta antes del primer uso:

```bash
mkdir -p /home/node/.n8n/boda-datos
```

(desde Coolify → N8N → Terminal → contenedor `n8n-...`).

Si en el futuro reimportas este workflow en OTRA instancia de n8n, repite este
mismo proceso de diagnóstico: prueba a escribir con "Execute step" en el nodo
"Guardar RSVP", y si da "not writable" en cualquier ruta que pruebes (incluso
`/tmp`), es casi seguro esta misma protección de n8n, no un problema real de
permisos — confírmalo con `touch /tmp/test` directamente en la terminal del
contenedor antes de tocar nada.

Los 4 nodos que deben coincidir dos a dos (mismo path exacto):

- "Guardar RSVP" → campo `fileName` ←→ "Leer RSVP" → campo `fileSelector`
- "Guardar Alergias" → campo `fileName` ←→ "Leer Alergias" → campo `fileSelector`

## 3. Crear la credencial del dashboard

Abre el nodo "Webhook Admin" → en Authentication ya aparece "Basic Auth" →
crea una credencial nueva:

- Nombre de la credencial: `Boda Admin Auth`
- Usuario: `gyj2027`
- Contraseña: la que prefieras — elígela tú mismo al crear la credencial y guárdala en tu gestor de contraseñas (no se documenta aquí en texto plano)

Guarda y selecciona esa credencial en el nodo.

*(En esta instancia ya está creada como `Boda Admin Auth`.)*

## 4. Activar el workflow

Publica el workflow (botón "Publish" arriba a la derecha en esta versión de
n8n; en otras puede ser un toggle "Active").

*(Ya publicado en esta instancia.)*

## 5. Probar los formularios

Desde una terminal:

```bash
curl -X POST https://n8n.ivangonzalez.cloud/webhook/boda-rsvp \
  -H "Content-Type: application/json" \
  -d '{"nombre":"Prueba","asiste":true,"acompanantes":1,"nombres_acompanantes":["Acompañante Prueba"]}'
```

Debe responder `{"ok":true}`. Repite con:

```bash
curl -X POST https://n8n.ivangonzalez.cloud/webhook/boda-alergenos \
  -H "Content-Type: application/json" \
  -d '{"nombre_persona":"Prueba","tipos":["Gluten"],"detalle":""}'
```

**Importante:** estas pruebas con `curl` no bastan por sí solas. Los formularios de la web usan `fetch` con `Content-Type: application/json`, lo que el navegador comprueba antes con una petición `OPTIONS` (CORS) — algo que `curl` no hace. El workflow ya trae "Allowed Origins" puesto a `*` en ambos webhooks POST, pero antes de dar esto por bueno, entra a la invitación ya desplegada en el navegador y envía un formulario real desde ahí. Si el `curl` funciona pero el envío desde el navegador falla con "Hubo un problema, inténtalo de nuevo...", revisa esa opción en el nodo del webhook correspondiente.

## 6. Probar el dashboard

Abre `https://n8n.ivangonzalez.cloud/webhook/boda-admin` en el navegador,
introduce el usuario/contraseña del paso 3, y confirma que aparecen las dos
filas de prueba en sus tablas.

## 7. Si algo no encaja

**El dashboard carga pero sale vacío, o dice "No se pudo leer...":**
1. Comprueba que la ruta de archivo del nodo "Guardar RSVP" coincide EXACTAMENTE con la de "Leer RSVP" (y lo mismo para Alergias/Alergenos) — un solo carácter distinto y no encontrará el archivo.
2. Comprueba que el archivo `.jsonl` existe y que cada línea empieza literalmente por `{` (no por una comilla `"`). Si ves comillas de más envolviendo cada línea, la opción "Use Raw Data" del nodo "JSON a Binario" no se aplicó igual en tu versión de n8n — avísame con el nombre exacto del campo que veas ahí.
3. Abre el historial de ejecuciones ("Executions") del webhook `boda-admin` en n8n y mira la salida de los nodos "Leer RSVP" y "Leer Alergias" para ver el error exacto, si lo hay.

**Un nodo aparece marcado en rojo al importar, con un error del tipo
"parámetro no reconocido" o similar:** es que tu versión de n8n difiere de la
esperada en ese nodo (probablemente "Read/Write Files from Disk" o "Move
Binary Data", que han cambiado de forma entre versiones). Anota qué nodo y
qué mensaje de error da exactamente, para poder ajustarlo.

## 8. Limpieza después de la boda

Cuando ya no haga falta nada de esto: desactiva el workflow, bórralo, y
borra los dos archivos `.jsonl` del disco de n8n.
