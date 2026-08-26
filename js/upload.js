// Lógica compartida de subida de fotos/vídeos al webhook de n8n.
// Usada por index.html (sección #recuerdos) y subir.html (QR).

const WEBHOOK_URL = 'https://n8n.ivangonzalez.cloud/webhook/boda-fotos';
const MAX_FILE_SIZE_BYTES = 50 * 1024 * 1024;
const ALLOWED_TYPE_PREFIXES = ['image/', 'video/'];

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
          const formData = new FormData();
          formData.append('data', file, file.name);
          const res = await fetch(WEBHOOK_URL, { method: 'POST', body: formData, signal: AbortSignal.timeout(120000) });
          if (res.ok) { okCount++; } else { failCount++; }
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
