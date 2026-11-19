// Lógica compartida de subida de fotos/vídeos al media-service (subida directa).
// Usada por index.html (sección #recuerdos) y subir.html (QR).

const UPLOAD_URL = 'https://bodagloriayjose.ivangonzalez.cloud/upload';
const MAX_FILE_SIZE_BYTES = 50 * 1024 * 1024;
const ALLOWED_TYPE_PREFIXES = ['image/', 'video/'];
const MAX_UPLOAD_ATTEMPTS = 3; // 1 intento inicial + 2 reintentos ante fallo de red
const RETRY_DELAY_MS = 2000; // pausa entre intentos, para dar tiempo real a una reconexión
const UPLOAD_TIMEOUT_BUDGET_MS = 120000; // presupuesto TOTAL compartido entre todos los intentos
const MIN_ATTEMPT_TIMEOUT_MS = 10000; // no lanzar un intento con menos de esto de presupuesto

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

        const isAllowedType = ALLOWED_TYPE_PREFIXES.some(p => file.type.startsWith(p));
        if (!isAllowedType || file.size > MAX_FILE_SIZE_BYTES) {
          rejectedCount++;
          continue;
        }

        try {
          const result = await uploadFileWithRetry(file, (pct) => {
            btnLabel.textContent = `Subiendo ${i + 1}/${files.length} — ${pct}%`;
          });
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
