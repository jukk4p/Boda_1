// Lógica compartida de subida de fotos/vídeos al media-service (subida directa).
// Usada por index.html (sección #recuerdos) y subir.html (QR).

const UPLOAD_URL = 'https://bodagloriayjose.ivangonzalez.cloud/upload';
const MAX_FILE_SIZE_BYTES = 500 * 1024 * 1024;
const ALLOWED_TYPE_PREFIXES = ['image/', 'video/'];
// Fallback extensions for when file.type comes back empty (see M9 below).
const ALLOWED_EMPTY_TYPE_EXTENSIONS = ['.heic', '.heif', '.mov', '.avi', '.mkv', '.mp4', '.3gp'];
const MAX_UPLOAD_ATTEMPTS = 3; // 1 intento inicial + 2 reintentos ante fallo de red
const RETRY_DELAY_MS = 2000; // pausa entre intentos, para dar tiempo real a una reconexión
const UPLOAD_TIMEOUT_BUDGET_MS = 120000; // presupuesto TOTAL compartido entre todos los intentos
const MIN_ATTEMPT_TIMEOUT_MS = 10000; // no lanzar un intento con menos de esto de presupuesto

// --- Subida por chunks (archivos grandes, reanudable entre recargas) ---
const CHUNK_THRESHOLD_BYTES = 20 * 1024 * 1024; // por encima de esto, se sube en chunks
const CHUNK_SIZE_BYTES = 5 * 1024 * 1024; // tamaño de cada chunk enviado a /upload/chunk
const CHUNK_RESUME_KEY_PREFIX = 'weddingUploadResume:'; // prefijo de las claves en localStorage
const MAX_CHUNK_ATTEMPTS = 3; // reintentos por chunk individual ante fallo de red
const CHUNK_RETRY_DELAY_MS = 2000; // misma pausa que el camino no-chunked, por consistencia
const CHUNK_UPLOAD_TIMEOUT_MS = 60000; // timeout por intento de UN chunk de 5MB (no por archivo)
const CHUNK_STATUS_TIMEOUT_MS = 10000; // timeout para la comprobación GET .../status

// Sube un único archivo vía XMLHttpRequest, con progreso real y reintento
// automático (hasta MAX_UPLOAD_ATTEMPTS intentos) cuando el fallo es de red
// (xhr.onerror / xhr.ontimeout). Un 4xx o 5xx significa que el servidor
// respondió — no es un fallo de red, así que no se reintenta: un 4xx es un
// error de validación (reintentar desperdicia los datos del invitado) y un
// 5xx se trata igual aquí porque la petición sí completó su ciclo
// request/response; no se distingue como "transitorio" sin que el brief lo
// pida explícitamente.
//
// Los reintentos esperan RETRY_DELAY_MS antes de relanzar (para darle una
// oportunidad real a una reconexión breve, en vez de agotar los 3 intentos
// en milisegundos) y comparten un único presupuesto de UPLOAD_TIMEOUT_BUDGET_MS
// entre TODOS los intentos — no 120s por intento — para que el peor caso total
// siga rondando el mismo techo de ~120s que existía antes de esta tarea.
// Resuelve con { ok: true } o { ok: false }; nunca rechaza.
function uploadFileWithRetry(file, onProgress) {
  return new Promise((resolve) => {
    let attempt = 0;
    const startTime = Date.now();

    function attemptUpload() {
      const remainingBudgetMs = UPLOAD_TIMEOUT_BUDGET_MS - (Date.now() - startTime);
      if (remainingBudgetMs < MIN_ATTEMPT_TIMEOUT_MS) {
        // No queda presupuesto compartido suficiente para un intento con
        // una oportunidad real de completar: nos rendimos ya en vez de
        // lanzar una petición con un timeout casi nulo.
        resolve({ ok: false });
        return;
      }

      attempt++;
      const xhr = new XMLHttpRequest();
      xhr.open('POST', UPLOAD_URL);
      xhr.timeout = remainingBudgetMs; // presupuesto restante, no 120000 fijo

      xhr.upload.onprogress = (event) => {
        if (event.lengthComputable) {
          onProgress(Math.round((event.loaded / event.total) * 100));
        }
      };

      xhr.onload = () => {
        resolve({ ok: xhr.status >= 200 && xhr.status < 300 });
      };

      function handleNetworkFailure() {
        if (attempt < MAX_UPLOAD_ATTEMPTS) {
          setTimeout(attemptUpload, RETRY_DELAY_MS);
        } else {
          resolve({ ok: false });
        }
      }

      xhr.onerror = handleNetworkFailure;
      xhr.ontimeout = handleNetworkFailure;

      const formData = new FormData();
      formData.append('data', file, file.name);
      xhr.send(formData);
    }

    attemptUpload();
  });
}

// Clave de resumo por archivo: name + size + lastModified, sin hashear
// contenido (igual que hacen las librerías de subida reanudable "ligeras" —
// es barato de calcular y suficiente para distinguir "el mismo archivo que
// dejamos a medias" de "un archivo distinto" en la práctica).
function buildChunkResumeKey(file) {
  return `${file.name}::${file.size}::${file.lastModified}`;
}

// Todo acceso a localStorage va envuelto en try/catch: en modo privado,
// con cuota agotada, o con localStorage deshabilitado, estas llamadas
// pueden lanzar. En ese caso degradamos con gracia — simplemente no hay
// resumption, y cada subida de un archivo grande arranca desde el chunk 0.
function getStoredChunkUploadId(resumeKey) {
  try {
    return localStorage.getItem(CHUNK_RESUME_KEY_PREFIX + resumeKey);
  } catch (err) {
    return null;
  }
}

function storeChunkUploadId(resumeKey, uploadId) {
  try {
    localStorage.setItem(CHUNK_RESUME_KEY_PREFIX + resumeKey, uploadId);
  } catch (err) {
    // No-op: sin persistencia no hay resumption, pero la subida sigue.
  }
}

function clearChunkUploadId(resumeKey) {
  try {
    localStorage.removeItem(CHUNK_RESUME_KEY_PREFIX + resumeKey);
  } catch (err) {
    // No-op.
  }
}

// Consulta qué chunks ya tiene el servidor para este uploadId. Devuelve
// { receivedChunks: Set, completed: boolean, id: string|null } en un 200,
// o null si la comprobación en sí falló: error de red, o (más raro) un 400
// porque el uploadId tiene un charset inválido — en la práctica esto solo
// pasa si localStorage guardaba un id corrupto de otro entorno, ya que
// crypto.randomUUID() siempre produce un charset válido. Un uploadId con
// charset válido pero DESCONOCIDO para el servidor (p. ej. su sesión fue
// barrida tras 48h de abandono) NO da 400: el servidor responde 200 con
// receivedChunks: [] (ver GET /upload/chunk/:uploadId/status en
// server.js), que ya tratamos igual que null más abajo. null es una señal
// segura de "empezar desde el chunk 0 con este mismo uploadId": el
// servidor trata cualquier uploadId que no reconoce como el arranque de
// una sesión nueva en el siguiente chunk que reciba (startOrGetSession),
// así que no hace falta generar un uploadId distinto ni podemos quedarnos
// en un bucle por esto.
function fetchReceivedChunks(uploadId) {
  return new Promise((resolve) => {
    const xhr = new XMLHttpRequest();
    xhr.open('GET', `${UPLOAD_URL}/chunk/${uploadId}/status`);
    xhr.timeout = CHUNK_STATUS_TIMEOUT_MS;
    xhr.onload = () => {
      if (xhr.status === 200) {
        try {
          const body = JSON.parse(xhr.responseText);
          resolve({
            receivedChunks: new Set(Array.isArray(body.receivedChunks) ? body.receivedChunks : []),
            completed: body.completed === true,
            id: typeof body.id === 'string' ? body.id : null
          });
        } catch (err) {
          resolve(null);
        }
      } else {
        resolve(null); // p. ej. 400 uploadId con charset inválido
      }
    };
    xhr.onerror = () => resolve(null);
    xhr.ontimeout = () => resolve(null);
    xhr.send();
  });
}

// Sube un único chunk vía XHR, con reintento ante fallo de red (hasta
// MAX_CHUNK_ATTEMPTS). Deliberadamente más simple que uploadFileWithRetry:
// cada chunk pesa como mucho CHUNK_SIZE_BYTES (5MB, fijo), así que un
// timeout fijo por intento es suficiente — no necesita el presupuesto
// compartido que sí hace falta cuando el archivo completo puede pesar
// hasta 500MB. Un 4xx/5xx significa que el servidor respondió y no se
// reintenta (mismo razonamiento que el camino no-chunked). La resumption
// entre recargas ya da una red de seguridad más gruesa (si el usuario
// recarga a mitad, retoma desde el primer chunk que falte), así que este
// reintento por chunk es solo para no obligar a una recarga completa ante
// un corte de red transitorio de un segundo.
function uploadChunkWithRetry({ uploadId, chunkIndex, totalChunks, blob, filename, mimetype }) {
  return new Promise((resolve) => {
    let attempt = 0;

    function attemptUpload() {
      attempt++;
      const xhr = new XMLHttpRequest();
      xhr.open('POST', `${UPLOAD_URL}/chunk`);
      xhr.timeout = CHUNK_UPLOAD_TIMEOUT_MS;

      xhr.onload = () => {
        if (xhr.status >= 200 && xhr.status < 300) {
          try {
            resolve({ ok: true, body: JSON.parse(xhr.responseText) });
          } catch (err) {
            resolve({ ok: false });
          }
        } else {
          resolve({ ok: false }); // 4xx/5xx: el servidor respondió, no se reintenta
        }
      };

      function handleNetworkFailure() {
        if (attempt < MAX_CHUNK_ATTEMPTS) {
          setTimeout(attemptUpload, CHUNK_RETRY_DELAY_MS);
        } else {
          resolve({ ok: false });
        }
      }

      xhr.onerror = handleNetworkFailure;
      xhr.ontimeout = handleNetworkFailure;

      const formData = new FormData();
      formData.append('uploadId', uploadId);
      formData.append('chunkIndex', String(chunkIndex));
      formData.append('totalChunks', String(totalChunks));
      formData.append('filename', filename);
      formData.append('mimetype', mimetype);
      formData.append('chunk', blob, filename);
      xhr.send(formData);
    }

    attemptUpload();
  });
}

// Sube un archivo grande (> CHUNK_THRESHOLD_BYTES) en chunks de
// CHUNK_SIZE_BYTES vía POST /upload/chunk, reanudando desde el primer
// chunk que falte si ya había una subida a medias para este mismo archivo
// (misma clave name+size+lastModified). El progreso se actualiza por
// chunk CONFIRMADO por el servidor (receivedChunks.length / totalChunks),
// nunca por los bytes en curso del chunk que se está enviando ahora mismo
// — así el porcentaje nunca retrocede ni se adelanta a lo que el servidor
// ya tiene realmente. Resuelve con { ok: true } o { ok: false }, igual que
// uploadFileWithRetry, para que el call site no necesite distinguir entre
// ambos caminos.
async function uploadFileChunked(file, onProgress) {
  const resumeKey = buildChunkResumeKey(file);
  let uploadId = getStoredChunkUploadId(resumeKey);
  const isResuming = !!uploadId;
  if (!uploadId) {
    uploadId = crypto.randomUUID();
    storeChunkUploadId(resumeKey, uploadId);
  }

  const totalChunks = Math.ceil(file.size / CHUNK_SIZE_BYTES);
  let receivedSet = new Set();

  if (isResuming) {
    const fetched = await fetchReceivedChunks(uploadId);
    if (fetched && fetched.completed) {
      // El servidor ya terminó esta subida en una sesión anterior (p. ej.
      // el último chunk se ensambló y proceso correctamente, pero la
      // respuesta de éxito nunca llegó a este cliente antes de recargar).
      // No hay nada que enviar: tratamos esto como éxito inmediato y
      // limpiamos la clave, igual que el camino normal de finalización.
      onProgress(100);
      clearChunkUploadId(resumeKey);
      return { ok: true };
    }
    if (fetched) {
      // Se ignoran índices fuera del rango actual de chunks: defensa ante
      // una clave de localStorage obsoleta que apuntara a una sesión
      // creada con un tamaño de chunk o de archivo distinto.
      for (const idx of fetched.receivedChunks) {
        if (idx >= 0 && idx < totalChunks) receivedSet.add(idx);
      }
    }
    // fetched === null → la comprobación de estado falló (red, o uploadId
    // con charset inválido) → receivedSet queda vacío, es decir, se
    // arranca desde el chunk 0 con el MISMO uploadId (el servidor
    // simplemente crea una sesión nueva para él en el próximo chunk).
  }

  onProgress(Math.round((receivedSet.size / totalChunks) * 100));

  for (let chunkIndex = 0; chunkIndex < totalChunks; chunkIndex++) {
    if (receivedSet.has(chunkIndex)) continue; // el servidor ya lo confirmó

    const start = chunkIndex * CHUNK_SIZE_BYTES;
    const end = Math.min(start + CHUNK_SIZE_BYTES, file.size);
    const blob = file.slice(start, end);

    const result = await uploadChunkWithRetry({
      uploadId, chunkIndex, totalChunks, blob,
      filename: file.name, mimetype: file.type
    });

    if (!result.ok) {
      return { ok: false };
    }

    if (result.body && result.body.id) {
      // El chunk que completa el conjunto: el servidor ya ensambló y
      // respondió con el item final (misma forma que uploadFileWithRetry
      // espera en su camino de éxito).
      onProgress(100);
      clearChunkUploadId(resumeKey);
      return { ok: true };
    }

    if (result.body && Array.isArray(result.body.receivedChunks)) {
      receivedSet = new Set(result.body.receivedChunks);
      onProgress(Math.round((receivedSet.size / totalChunks) * 100));
    } else {
      // Forma de respuesta inesperada: mejor fallar explícitamente que
      // perder la cuenta de qué se confirmó de verdad.
      return { ok: false };
    }
  }

  // Caso límite defensivo: la comprobación de estado inicial ya marcaba
  // todos los chunks como recibidos (p. ej. una subida anterior escribió
  // el último chunk pero la respuesta de ensamblado nunca llegó a este
  // cliente — crash de red justo después de completar en el servidor), así
  // que el bucle de arriba no envió nada. Reenviar el último chunk es
  // idempotente (writeChunk sobrescribe el mismo índice) y fuerza a
  // assembleIfComplete a correr de nuevo si de verdad falta ensamblar.
  if (totalChunks > 0) {
    const lastIndex = totalChunks - 1;
    const start = lastIndex * CHUNK_SIZE_BYTES;
    const end = Math.min(start + CHUNK_SIZE_BYTES, file.size);
    const blob = file.slice(start, end);
    const result = await uploadChunkWithRetry({
      uploadId, chunkIndex: lastIndex, totalChunks, blob,
      filename: file.name, mimetype: file.type
    });
    if (result.ok && result.body && result.body.id) {
      onProgress(100);
      clearChunkUploadId(resumeKey);
      return { ok: true };
    }
  }
  return { ok: false };
}

function initUploadFlow({ buttonId, inputId, labelId, isActive, lockedMessage }) {
  const btn = document.getElementById(buttonId);
  const input = document.getElementById(inputId);
  const btnLabel = document.getElementById(labelId);
  if (!btn || !input || !btnLabel) return;

  const originalLabel = btnLabel.textContent;
  let isUploading = false;
  let resetLabelTimeoutId = null;

  function handleUploadClick() {
    if (!isActive()) {
      alert(lockedMessage);
      return;
    }
    if (isUploading) return;
    input.click();
  }

  btn.addEventListener('click', handleUploadClick);

  input.addEventListener('change', async (e) => {
    const files = Array.from(e.target.files);
    e.target.value = '';
    if (files.length === 0) return;

    let okCount = 0;
    let failCount = 0;
    let rejectedCount = 0;

    isUploading = true;
    try {
      for (let i = 0; i < files.length; i++) {
        const file = files[i];
        btnLabel.textContent = `Subiendo ${i + 1}/${files.length}…`;

        // Algunos navegadores de escritorio devuelven file.type === '' para
        // .heic/.heif y algunos .mov (no reconocen el tipo MIME), lo que
        // rechazaría de entrada un archivo perfectamente válido antes de
        // llegar siquiera al servidor. Si el tipo viene vacío, se cae a
        // comprobar la extensión en vez de rechazar directamente.
        const lowerName = (file.name || '').toLowerCase();
        const isAllowedType = file.type
          ? ALLOWED_TYPE_PREFIXES.some(p => file.type.startsWith(p))
          : ALLOWED_EMPTY_TYPE_EXTENSIONS.some(ext => lowerName.endsWith(ext));
        if (!isAllowedType || file.size > MAX_FILE_SIZE_BYTES) {
          rejectedCount++;
          continue;
        }

        try {
          const onProgress = (pct) => {
            btnLabel.textContent = `Subiendo ${i + 1}/${files.length} — ${pct}%`;
          };
          // Por encima del umbral se sube en chunks (resumible entre
          // recargas); a partir de aquí para abajo, exactamente el mismo
          // camino de siempre. Ambos resuelven con la misma forma
          // { ok: true|false }, así que el conteo de abajo no cambia.
          const result = file.size > CHUNK_THRESHOLD_BYTES
            ? await uploadFileChunked(file, onProgress)
            : await uploadFileWithRetry(file, onProgress);
          if (result.ok) { okCount++; } else { failCount++; }
        } catch (err) {
          failCount++;
        }
      }

      let statusText;
      if (failCount === 0 && rejectedCount === 0) {
        statusText = '¡Gracias, recibido!';
      } else if (okCount > 0) {
        statusText = `${okCount} subida(s), ${failCount} con error`;
      } else {
        statusText = 'Hubo un problema, inténtalo de nuevo';
      }
      if (rejectedCount > 0) {
        statusText += ` — ${rejectedCount} archivo(s) no válido(s) (tipo o tamaño)`;
      }
      btnLabel.textContent = statusText;

      if (resetLabelTimeoutId) clearTimeout(resetLabelTimeoutId);
      resetLabelTimeoutId = setTimeout(() => { btnLabel.textContent = originalLabel; }, 3000);
    } finally {
      isUploading = false;
    }
  });
}
