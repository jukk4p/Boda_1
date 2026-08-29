# Configurar el workflow "Boda - Formularios" en n8n

Este workflow no se puede probar desde fuera de tu instancia de n8n, así que
tras importarlo hay que verificarlo a mano. Pasos:

## 1. Importar

En `https://n8n.ivangonzalez.cloud`: Workflows → botón "Import from File" (o
"..." → Import from File/URL) → selecciona `boda-formularios.workflow.json`.

## 2. Comprobar la ruta de archivos

El workflow escribe/lee en `/data/boda-rsvp.jsonl` y `/data/boda-alergenos.jsonl`
dentro del contenedor de n8n. Si tu instalación no tiene un directorio `/data`
persistente y escribible, cambia la ruta en los 4 nodos siguientes por una que
sí lo sea (por ejemplo, un subdirectorio dentro del volumen de datos de n8n
que ya uses, tipo `/home/node/.n8n/boda-rsvp.jsonl`):

- "Guardar RSVP" → campo `fileName`
- "Guardar Alergias" → campo `fileName`
- "Leer RSVP" → campo `fileSelector`
- "Leer Alergias" → campo `fileSelector`

Las 4 rutas deben coincidir dos a dos (la de "Guardar RSVP" con la de "Leer
RSVP", y la de "Guardar Alergias" con la de "Leer Alergias").

## 3. Crear la credencial del dashboard

Abre el nodo "Webhook Admin" → en Authentication ya aparece "Basic Auth" →
crea una credencial nueva:

- Nombre de la credencial: `Boda Admin Auth`
- Usuario: `gyj2027`
- Contraseña: la que prefieras — elígela tú mismo al crear la credencial y guárdala en tu gestor de contraseñas (no se documenta aquí en texto plano)

Guarda y selecciona esa credencial en el nodo.

## 4. Activar el workflow

Activa el toggle "Active" del workflow (arriba a la derecha).

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
