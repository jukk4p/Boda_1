// Lógica compartida de envío de los formularios de Asistencia y Alergias
// al webhook de n8n. Mismo patrón que js/upload.js.

const RSVP_WEBHOOK_URL = 'https://n8n.ivangonzalez.cloud/webhook/boda-rsvp';
const ALERGENOS_WEBHOOK_URL = 'https://n8n.ivangonzalez.cloud/webhook/boda-alergenos';

function submitJsonForm({ form, webhookUrl, statusEl, submitBtn, buildPayload, validate, successMessage }) {
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    statusEl.textContent = '';
    statusEl.className = 'form-status';

    const validationError = validate();
    if (validationError) {
      statusEl.textContent = validationError;
      statusEl.classList.add('form-status--error');
      return;
    }

    const payload = buildPayload();
    submitBtn.disabled = true;
    const originalLabel = submitBtn.textContent;
    submitBtn.textContent = 'Enviando…';

    try {
      const res = await fetch(webhookUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(20000)
      });
      if (!res.ok) throw new Error('respuesta no ok');
      statusEl.textContent = successMessage;
      statusEl.classList.add('form-status--success');
      form.reset();
    } catch (err) {
      statusEl.textContent = 'Hubo un problema, inténtalo de nuevo o escríbenos por WhatsApp.';
      statusEl.classList.add('form-status--error');
    } finally {
      submitBtn.disabled = false;
      submitBtn.textContent = originalLabel;
    }
  });
}

function initRsvpForm({ formId, statusId, submitBtnId, companionsInputId, companionsContainerId }) {
  const form = document.getElementById(formId);
  if (!form) return;
  const statusEl = document.getElementById(statusId);
  const submitBtn = document.getElementById(submitBtnId);
  const companionsInput = document.getElementById(companionsInputId);
  const companionsContainer = document.getElementById(companionsContainerId);

  function renderCompanionFields() {
    const asisteRadio = form.querySelector('input[name="asiste"]:checked');
    const asiste = asisteRadio ? asisteRadio.value === 'si' : false;
    companionsInput.closest('.form-field').style.display = asiste ? '' : 'none';
    companionsContainer.innerHTML = '';
    if (!asiste) { companionsInput.value = '0'; return; }

    const count = Math.max(0, Math.min(10, parseInt(companionsInput.value, 10) || 0));
    for (let i = 0; i < count; i++) {
      const wrap = document.createElement('div');
      wrap.className = 'form-field';
      wrap.innerHTML = `
        <label class="form-label">Nombre del acompañante ${i + 1}</label>
        <input type="text" class="form-input companion-name-input" required>
      `;
      companionsContainer.appendChild(wrap);
    }
  }

  form.querySelectorAll('input[name="asiste"]').forEach(r => r.addEventListener('change', renderCompanionFields));
  companionsInput.addEventListener('input', renderCompanionFields);
  renderCompanionFields();

  submitJsonForm({
    form,
    webhookUrl: RSVP_WEBHOOK_URL,
    statusEl,
    submitBtn,
    validate: () => {
      const nombre = form.querySelector('[name="nombre"]').value.trim();
      if (!nombre) return 'Por favor, indica tu nombre.';
      return '';
    },
    buildPayload: () => {
      const nombre = form.querySelector('[name="nombre"]').value.trim();
      const asiste = form.querySelector('input[name="asiste"]:checked').value === 'si';
      const acompanantes = asiste ? Math.max(0, Math.min(10, parseInt(companionsInput.value, 10) || 0)) : 0;
      const nombresAcompanantes = Array.from(companionsContainer.querySelectorAll('.companion-name-input'))
        .map(i => i.value.trim())
        .filter(Boolean);
      return { nombre, asiste, acompanantes, nombres_acompanantes: nombresAcompanantes };
    },
    successMessage: '¡Gracias por confirmar!'
  });
}
