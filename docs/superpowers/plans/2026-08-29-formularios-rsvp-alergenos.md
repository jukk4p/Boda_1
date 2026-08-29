# Formularios de Asistencia y Alergias + Dashboard admin (n8n) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Reemplazar los botones de WhatsApp de "Confirmar Asistencia" y "Alergias e Intolerancias" por formularios reales que envían sus datos a dos webhooks nuevos del n8n existente, más un tercer webhook con Basic Auth que sirve un dashboard HTML de solo lectura con lo recibido.

**Architecture:** Front-end: dos `<form>` en `index.html` con lógica compartida en `js/forms.js` (mismo patrón `fetch()` + estado en botón que ya usa `js/upload.js`). Backend: un único workflow de n8n (`n8n/boda-formularios.workflow.json`, importable) con 3 ramas — 2 webhooks POST que anexan una línea JSON a un archivo `.jsonl` en disco, y 1 webhook GET con Basic Auth que lee ambos archivos y genera una tabla HTML.

**Tech Stack:** HTML/CSS/JS vanilla (sin build ni framework), n8n (self-hosted) para el backend.

**Spec:** `docs/superpowers/specs/2026-08-29-formularios-rsvp-alergenos-design.md`

## Global Constraints

- No se añade ningún servicio ni dependencia de terceros nueva; todo pasa por el n8n existente (`https://n8n.ivangonzalez.cloud`).
- Persistencia en archivos `.jsonl` en disco de n8n vía nodos nativos ("Read/Write Files from Disk"), no el nodo "Data Table" (demasiado reciente para asegurar compatibilidad).
- El formulario es el método principal en ambas secciones; se conserva un enlace de WhatsApp más pequeño como alternativa debajo de cada uno.
- Credenciales del dashboard: usuario `gyj2027`, contraseña `HaciendaGJ-27!` (credencial Basic Auth nativa de n8n, creada a mano por el usuario — no viaja en el JSON del workflow).
- Nada de esto debe sobrevivir mucho más allá de la boda (31/07/2027) — no se añade backup, migración ni escalabilidad.
- **Nota sobre testing:** este repo es un sitio estático sin framework de tests (confirmado: no hay `package.json`, ni carpeta `tests/`). La verificación de los cambios de front-end es manual en navegador (servidor local + revisión visual/consola), siguiendo el patrón ya usado en este proyecto. La verificación del workflow de n8n es, en parte, manual por el usuario final (sin acceso a su instancia desde esta sesión); la parte automatizable (validez del JSON) sí se comprueba con un comando.

---

### Task 1: Formulario de Confirmar Asistencia (RSVP)

**Files:**
- Create: `js/forms.js`
- Modify: `index.html` (CSS del bloque `<style>`, sección `#confirmar`, script tags al final del `<body>`)

**Interfaces:**
- Produces: función global `submitJsonForm({ form, webhookUrl, statusEl, submitBtn, buildPayload, validate, successMessage })` en `js/forms.js` — helper genérico de envío, reutilizado por Task 2.
- Produces: función global `initRsvpForm({ formId, statusId, submitBtnId, companionsInputId, companionsContainerId })` en `js/forms.js`.
- Produces: constante `RSVP_WEBHOOK_URL` en `js/forms.js` = `'https://n8n.ivangonzalez.cloud/webhook/boda-rsvp'`.

- [ ] **Step 1: Añadir el CSS de formularios**

En `index.html`, busca este bloque (justo antes del comentario `/* ── MODALS & POPUPS ── */`):

```css
  .btn-whatsapp:hover .wa-arrow { transform: translateX(4px); color: #25D366; }

  /* ── MODALS & POPUPS ──────────────────────────────── */
```

Reemplázalo por (añade el nuevo bloque de estilos de formulario justo antes del comentario de modals, sin tocar nada más):

```css
  .btn-whatsapp:hover .wa-arrow { transform: translateX(4px); color: #25D366; }

  /* ── 7.5 FORMULARIOS (RSVP / ALERGIAS) ────────────── */
  .form-card {
    display: flex;
    flex-direction: column;
    gap: 1.1rem;
    margin-top: 1.6rem;
  }
  .form-field { display: flex; flex-direction: column; gap: 0.4rem; text-align: left; }
  .form-label {
    font-family: 'Montserrat', sans-serif;
    font-size: 0.72rem;
    font-weight: 600;
    letter-spacing: 0.06em;
    text-transform: uppercase;
    color: var(--gold-dark);
  }
  .form-input,
  .form-textarea {
    font-family: 'Montserrat', sans-serif;
    font-size: 0.95rem;
    color: var(--dark-text);
    background: var(--bg-cream);
    border: 1px solid var(--border-gold);
    border-radius: 12px;
    padding: 0.75rem 1rem;
  }
  .form-input:focus,
  .form-textarea:focus { outline: none; border-color: var(--gold); }
  .form-textarea { resize: vertical; min-height: 90px; }
  .form-radio-group,
  .form-checkbox-group { display: flex; flex-wrap: wrap; gap: 0.7rem 1.2rem; }
  .form-radio-option,
  .form-checkbox-option {
    display: flex; align-items: center; gap: 0.5rem;
    font-family: 'Montserrat', sans-serif; font-size: 0.9rem; color: var(--dark-text);
  }
  .form-submit-btn {
    align-self: center;
    padding: 0.95rem 2.4rem;
    background: linear-gradient(135deg, var(--emerald) 0%, var(--emerald-dark) 100%);
    color: var(--gold-light);
    border: 1px solid var(--gold);
    border-radius: 50px;
    font-family: 'Montserrat', sans-serif;
    font-size: 0.78rem;
    font-weight: 600;
    letter-spacing: 0.1em;
    text-transform: uppercase;
    cursor: pointer;
    transition: all 0.3s ease;
  }
  .form-submit-btn:hover:not(:disabled) { transform: translateY(-2px); color: #fff; }
  .form-submit-btn:disabled { opacity: 0.6; cursor: not-allowed; }
  .form-status { text-align: center; font-size: 0.88rem; min-height: 1.2em; }
  .form-status--success { color: var(--emerald); }
  .form-status--error { color: #a94442; }
  .wa-inline-links {
    text-align: center;
    margin-top: 0.4rem;
    font-family: 'Montserrat', sans-serif;
    font-size: 0.78rem;
    color: var(--muted-text);
  }
  .wa-inline-links a { color: var(--gold-dark); text-decoration: underline; margin: 0 0.3rem; }

  /* ── MODALS & POPUPS ──────────────────────────────── */
```

- [ ] **Step 2: Reemplazar la sección `#confirmar` por el formulario**

Busca este bloque completo dentro de `<div class="section-wrap reveal" id="confirmar">`:

```html
      <div class="section-header">
        <p class="section-tag">Vía WhatsApp</p>
        <h2 class="section-title">Confirma Tu Asistencia</h2>
        <div class="divider-gold"><span class="line"></span><span class="icon"><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6"><rect x="3" y="5" width="18" height="14" rx="2"/><path d="M3 7l9 6 9-6"/></svg></span><span class="line"></span></div>
      </div>
      <p style="text-align:center; font-size:1.05rem; color:var(--body-text); margin-bottom:1.2rem;">
        Nos hará muy felices contar contigo en nuestro gran día. Por favor, confirma tu asistencia directamente por WhatsApp:
      </p>
      <div class="rsvp-buttons">
        <a class="btn-whatsapp" href="https://wa.me/34646269513?text=Hola%20Gloria%2C%20confirmo%20mi%20asistencia%20a%20vuestra%20boda%20el%2031%20de%20julio%20de%202027." target="_blank">
          <div class="wa-icon-badge">
            <svg width="22" height="22" viewBox="0 0 24 24" fill="currentColor">
              <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z"/>
            </svg>
          </div>
          <div class="wa-content">
            <span class="wa-title">Confirmar con Gloria</span>
            <span class="wa-sub">Enviar mensaje por WhatsApp</span>
          </div>
          <span class="wa-arrow">➔</span>
        </a>

        <a class="btn-whatsapp" href="https://wa.me/34658898406?text=Hola%20Jos%C3%A9%2C%20confirmo%20mi%20asistencia%20a%20vuestra%20boda%20el%2031%20de%20julio%20de%202027." target="_blank">
          <div class="wa-icon-badge">
            <svg width="22" height="22" viewBox="0 0 24 24" fill="currentColor">
              <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z"/>
            </svg>
          </div>
          <div class="wa-content">
            <span class="wa-title">Confirmar con José</span>
            <span class="wa-sub">Enviar mensaje por WhatsApp</span>
          </div>
          <span class="wa-arrow">➔</span>
        </a>
      </div>
```

Reemplázalo por:

```html
      <div class="section-header">
        <p class="section-tag">Tu Respuesta Es Importante</p>
        <h2 class="section-title">Confirma Tu Asistencia</h2>
        <div class="divider-gold"><span class="line"></span><span class="icon"><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6"><rect x="3" y="5" width="18" height="14" rx="2"/><path d="M3 7l9 6 9-6"/></svg></span><span class="line"></span></div>
      </div>
      <p style="text-align:center; font-size:1.05rem; color:var(--body-text); margin-bottom:1.2rem;">
        Nos hará muy felices contar contigo en nuestro gran día. Por favor, confirma tu asistencia aquí abajo:
      </p>
      <form class="form-card" id="rsvp-form">
        <div class="form-field">
          <label class="form-label" for="rsvp-nombre">Tu nombre</label>
          <input type="text" id="rsvp-nombre" name="nombre" class="form-input" required>
        </div>
        <div class="form-field">
          <label class="form-label">¿Asistirás?</label>
          <div class="form-radio-group">
            <label class="form-radio-option"><input type="radio" name="asiste" value="si" checked> Sí, allí estaré</label>
            <label class="form-radio-option"><input type="radio" name="asiste" value="no"> No podré ir</label>
          </div>
        </div>
        <div class="form-field">
          <label class="form-label" for="rsvp-acompanantes">Número de acompañantes</label>
          <input type="number" id="rsvp-acompanantes" class="form-input" min="0" max="10" value="0">
        </div>
        <div id="rsvp-companions-container"></div>
        <button type="submit" class="form-submit-btn" id="rsvp-submit-btn">Confirmar Asistencia</button>
        <p class="form-status" id="rsvp-status"></p>
      </form>
      <p class="wa-inline-links">
        ¿Prefieres avisarnos por WhatsApp?
        <a href="https://wa.me/34646269513?text=Hola%20Gloria%2C%20confirmo%20mi%20asistencia%20a%20vuestra%20boda%20el%2031%20de%20julio%20de%202027." target="_blank">Escribir a Gloria</a>
        ·
        <a href="https://wa.me/34658898406?text=Hola%20Jos%C3%A9%2C%20confirmo%20mi%20asistencia%20a%20vuestra%20boda%20el%2031%20de%20julio%20de%202027." target="_blank">Escribir a José</a>
      </p>
```

- [ ] **Step 3: Crear `js/forms.js` con el helper compartido y la lógica de RSVP**

Crea el archivo `js/forms.js` con este contenido exacto:

```js
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
```

- [ ] **Step 4: Enlazar `forms.js` e inicializar el formulario RSVP**

En `index.html`, busca:

```html
<script src="js/qrcode.js"></script>
<script src="js/upload.js"></script>
```

Reemplázalo por:

```html
<script src="js/qrcode.js"></script>
<script src="js/upload.js"></script>
<script src="js/forms.js"></script>
```

Luego busca este bloque (el cierre de la llamada a `initUploadFlow`):

```js
  initUploadFlow({
    buttonId: 'upload-btn',
    inputId: 'upload-input',
    labelId: 'upload-btn-label',
    isActive: () => uploadActive,
    lockedMessage: '¡Esta sección se activará el día de la boda (31 de julio de 2027)! Guardad vuestras fotos y compartidlas con nosotros ese día. 💍'
  });
```

Y añade justo después (sin modificar nada de lo anterior):

```js
  initUploadFlow({
    buttonId: 'upload-btn',
    inputId: 'upload-input',
    labelId: 'upload-btn-label',
    isActive: () => uploadActive,
    lockedMessage: '¡Esta sección se activará el día de la boda (31 de julio de 2027)! Guardad vuestras fotos y compartidlas con nosotros ese día. 💍'
  });

  // ── FORMULARIO DE ASISTENCIA: envío al webhook de n8n ──
  // Lógica compartida en js/forms.js
  initRsvpForm({
    formId: 'rsvp-form',
    statusId: 'rsvp-status',
    submitBtnId: 'rsvp-submit-btn',
    companionsInputId: 'rsvp-acompanantes',
    companionsContainerId: 'rsvp-companions-container'
  });
```

- [ ] **Step 5: Verificación manual en navegador**

No hay framework de tests en este repo (sitio estático), así que la verificación es manual, siguiendo el patrón ya usado en el proyecto:

1. Arranca un servidor local desde la raíz del repo: `python -m http.server 8000`.
2. Abre `http://localhost:8000/index.html?open=1` en Chrome (usa las herramientas `claude-in-chrome`: `tabs_create_mcp`, `navigate`, `computer`, `read_console_messages`).
3. Navega a la sección "Confirma Tu Asistencia" (enlace del menú "Asistencia" o `#confirmar`).
4. Verifica que aparece el formulario (nombre, radios sí/no, número de acompañantes) y, debajo, el enlace pequeño "¿Prefieres avisarnos por WhatsApp?" con los dos enlaces.
5. Cambia "Número de acompañantes" a `2` — deben aparecer 2 campos "Nombre del acompañante 1/2". Cambia a `0` — deben desaparecer.
6. Marca "No podré ir" — el campo de número de acompañantes y sus campos dinámicos deben ocultarse.
7. Rellena el nombre, deja "Sí, allí estaré", pulsa "Confirmar Asistencia". Como el webhook de n8n todavía no existe (se crea en la Task 3), la petición fallará: comprueba que aparece el mensaje "Hubo un problema, inténtalo de nuevo o escríbenos por WhatsApp." en rojo bajo el formulario, y que el botón vuelve a estar habilitado con su texto original.
8. Revisa `read_console_messages` — no debe haber errores de JavaScript (el error de red del fetch es esperado y no es un error de consola bloqueante).

- [ ] **Step 6: Commit**

```bash
git add index.html js/forms.js
git commit -m "Sustituye los botones de WhatsApp de Confirmar Asistencia por un formulario real"
```

---

### Task 2: Formulario de Alergias e Intolerancias

**Files:**
- Modify: `js/forms.js` (añade `initAlergenosForm`)
- Modify: `index.html` (sección `#alergias`)

**Interfaces:**
- Consumes: `submitJsonForm(...)` de Task 1 (mismo módulo `js/forms.js`).
- Consumes: constante `ALERGENOS_WEBHOOK_URL` ya definida en Task 1.
- Produces: función global `initAlergenosForm({ formId, statusId, submitBtnId, otrosCheckboxId, detalleFieldId })`.

- [ ] **Step 1: Reemplazar la sección `#alergias` por el formulario**

Busca este bloque completo dentro de `<div class="section-wrap reveal" id="alergias">`:

```html
      <div class="section-header">
        <p class="section-tag">Tu Bienestar Nos Importa</p>
        <h2 class="section-title">Alergias e Intolerancias</h2>
        <div class="divider-gold"><span class="line"></span><span class="icon"><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6"><path d="M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z"/><path d="M12 9v4"/><path d="M12 16h.01"/></svg></span><span class="line"></span></div>
      </div>
      <p style="text-align:center; font-size:1.05rem; color:var(--body-text); margin-bottom:1.2rem;">
        Queremos que disfrutéis del menú sin preocupaciones. Si tú o alguno de tus acompañantes tenéis alguna alergia o intolerancia alimentaria, avisadnos por WhatsApp:
      </p>
      <div class="rsvp-buttons">
        <a class="btn-whatsapp" href="https://wa.me/34646269513?text=Hola%20Gloria%2C%20quiero%20avisaros%20de%20una%20alergia%20o%20intolerancia%20alimentaria%20para%20la%20boda%3A%20" target="_blank">
          <div class="wa-icon-badge">
            <svg width="22" height="22" viewBox="0 0 24 24" fill="currentColor">
              <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z"/>
            </svg>
          </div>
          <div class="wa-content">
            <span class="wa-title">Avisar a Gloria</span>
            <span class="wa-sub">Enviar mensaje por WhatsApp</span>
          </div>
          <span class="wa-arrow">➔</span>
        </a>

        <a class="btn-whatsapp" href="https://wa.me/34658898406?text=Hola%20Jos%C3%A9%2C%20quiero%20avisaros%20de%20una%20alergia%20o%20intolerancia%20alimentaria%20para%20la%20boda%3A%20" target="_blank">
          <div class="wa-icon-badge">
            <svg width="22" height="22" viewBox="0 0 24 24" fill="currentColor">
              <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z"/>
            </svg>
          </div>
          <div class="wa-content">
            <span class="wa-title">Avisar a José</span>
            <span class="wa-sub">Enviar mensaje por WhatsApp</span>
          </div>
          <span class="wa-arrow">➔</span>
        </a>
      </div>
```

Reemplázalo por:

```html
      <div class="section-header">
        <p class="section-tag">Tu Bienestar Nos Importa</p>
        <h2 class="section-title">Alergias e Intolerancias</h2>
        <div class="divider-gold"><span class="line"></span><span class="icon"><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6"><path d="M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z"/><path d="M12 9v4"/><path d="M12 16h.01"/></svg></span><span class="line"></span></div>
      </div>
      <p style="text-align:center; font-size:1.05rem; color:var(--body-text); margin-bottom:1.2rem;">
        Queremos que disfrutéis del menú sin preocupaciones. Cuéntanos aquí si tú o alguno de tus acompañantes tenéis alguna alergia o intolerancia alimentaria:
      </p>
      <form class="form-card" id="alergenos-form">
        <div class="form-field">
          <label class="form-label" for="alergenos-nombre">Nombre de la persona</label>
          <input type="text" id="alergenos-nombre" name="nombre_persona" class="form-input" placeholder="Puede ser tú o un acompañante" required>
        </div>
        <div class="form-field">
          <label class="form-label">Tipo de alergia o intolerancia</label>
          <div class="form-checkbox-group">
            <label class="form-checkbox-option"><input type="checkbox" name="tipos" value="Gluten"> Gluten</label>
            <label class="form-checkbox-option"><input type="checkbox" name="tipos" value="Lactosa"> Lactosa</label>
            <label class="form-checkbox-option"><input type="checkbox" name="tipos" value="Frutos secos"> Frutos secos</label>
            <label class="form-checkbox-option"><input type="checkbox" name="tipos" value="Marisco o pescado"> Marisco o pescado</label>
            <label class="form-checkbox-option"><input type="checkbox" name="tipos" value="Huevo"> Huevo</label>
            <label class="form-checkbox-option"><input type="checkbox" name="tipos" value="Otros" id="alergenos-otros-checkbox"> Otros</label>
          </div>
        </div>
        <div class="form-field">
          <label class="form-label" for="alergenos-detalle">Cuéntanos más</label>
          <textarea id="alergenos-detalle" name="detalle" class="form-textarea" placeholder="Describe la alergia o intolerancia"></textarea>
        </div>
        <button type="submit" class="form-submit-btn" id="alergenos-submit-btn">Enviar Aviso</button>
        <p class="form-status" id="alergenos-status"></p>
      </form>
      <p class="wa-inline-links">
        ¿Prefieres avisarnos por WhatsApp?
        <a href="https://wa.me/34646269513?text=Hola%20Gloria%2C%20quiero%20avisaros%20de%20una%20alergia%20o%20intolerancia%20alimentaria%20para%20la%20boda%3A%20" target="_blank">Escribir a Gloria</a>
        ·
        <a href="https://wa.me/34658898406?text=Hola%20Jos%C3%A9%2C%20quiero%20avisaros%20de%20una%20alergia%20o%20intolerancia%20alimentaria%20para%20la%20boda%3A%20" target="_blank">Escribir a José</a>
      </p>
```

- [ ] **Step 2: Añadir `initAlergenosForm` a `js/forms.js`**

Al final de `js/forms.js`, después de la función `initRsvpForm` (no borres nada existente), añade:

```js

function initAlergenosForm({ formId, statusId, submitBtnId, otrosCheckboxId, detalleFieldId }) {
  const form = document.getElementById(formId);
  if (!form) return;
  const statusEl = document.getElementById(statusId);
  const submitBtn = document.getElementById(submitBtnId);
  const otrosCheckbox = document.getElementById(otrosCheckboxId);
  const detalleField = document.getElementById(detalleFieldId);

  function toggleDetalle() {
    detalleField.closest('.form-field').style.display = otrosCheckbox.checked ? '' : 'none';
  }
  otrosCheckbox.addEventListener('change', toggleDetalle);
  toggleDetalle();

  submitJsonForm({
    form,
    webhookUrl: ALERGENOS_WEBHOOK_URL,
    statusEl,
    submitBtn,
    validate: () => {
      const nombre = form.querySelector('[name="nombre_persona"]').value.trim();
      if (!nombre) return 'Por favor, indica el nombre.';
      const tipos = Array.from(form.querySelectorAll('input[name="tipos"]:checked'));
      if (tipos.length === 0) return 'Selecciona al menos un tipo de alergia o intolerancia.';
      if (otrosCheckbox.checked && !detalleField.value.trim()) return 'Describe brevemente la alergia en "Otros".';
      return '';
    },
    buildPayload: () => {
      const nombre_persona = form.querySelector('[name="nombre_persona"]').value.trim();
      const tipos = Array.from(form.querySelectorAll('input[name="tipos"]:checked')).map(c => c.value);
      const detalle = detalleField.value.trim();
      return { nombre_persona, tipos, detalle };
    },
    successMessage: '¡Gracias por avisarnos!'
  });
}
```

- [ ] **Step 3: Inicializar el formulario de alergias**

En `index.html`, busca el bloque añadido en la Task 1:

```js
  // ── FORMULARIO DE ASISTENCIA: envío al webhook de n8n ──
  // Lógica compartida en js/forms.js
  initRsvpForm({
    formId: 'rsvp-form',
    statusId: 'rsvp-status',
    submitBtnId: 'rsvp-submit-btn',
    companionsInputId: 'rsvp-acompanantes',
    companionsContainerId: 'rsvp-companions-container'
  });
```

Y añade justo después:

```js

  // ── FORMULARIO DE ALERGIAS: envío al webhook de n8n ────
  // Lógica compartida en js/forms.js
  initAlergenosForm({
    formId: 'alergenos-form',
    statusId: 'alergenos-status',
    submitBtnId: 'alergenos-submit-btn',
    otrosCheckboxId: 'alergenos-otros-checkbox',
    detalleFieldId: 'alergenos-detalle'
  });
```

- [ ] **Step 4: Verificación manual en navegador**

1. Con el servidor local (`python -m http.server 8000`) ya arrancado, recarga `http://localhost:8000/index.html?open=1`.
2. Ve a la sección "Alergias e Intolerancias" (enlace del menú "Alergias" o `#alergias`).
3. Verifica que aparecen el nombre, los 6 checkboxes, y que el campo "Cuéntanos más" está oculto al principio.
4. Marca "Otros" — el campo "Cuéntanos más" debe aparecer. Desmárcalo — debe ocultarse de nuevo.
5. Pulsa "Enviar Aviso" sin rellenar nada — debe mostrarse "Por favor, indica el nombre." sin llegar a hacer ninguna petición de red (compruébalo en `read_network_requests`, no debe haber ninguna llamada a `boda-alergenos`).
6. Rellena el nombre, marca "Gluten", pulsa "Enviar Aviso" — como el webhook aún no existe, debe fallar y mostrar "Hubo un problema, inténtalo de nuevo o escríbenos por WhatsApp." (igual que en Task 1).
7. Revisa `read_console_messages` — sin errores de JavaScript.

- [ ] **Step 5: Commit**

```bash
git add index.html js/forms.js
git commit -m "Sustituye los botones de WhatsApp de Alergias por un formulario real"
```

---

### Task 3: Workflow de n8n (backend) + guía de configuración

**Files:**
- Create: `n8n/boda-formularios.workflow.json`
- Create: `n8n/SETUP.md`

**Interfaces:**
- Consumes: los payloads JSON generados por `initRsvpForm`/`initAlergenosForm` (Task 1 y 2) — mismos nombres de campo (`nombre`, `asiste`, `acompanantes`, `nombres_acompanantes`, `nombre_persona`, `tipos`, `detalle`).
- Produces: 3 endpoints en `https://n8n.ivangonzalez.cloud`: `POST /webhook/boda-rsvp`, `POST /webhook/boda-alergenos`, `GET /webhook/boda-admin` (Basic Auth).

- [ ] **Step 1: Crear el workflow importable**

Crea el archivo `n8n/boda-formularios.workflow.json` con este contenido exacto:

```json
{
  "name": "Boda - Formularios",
  "nodes": [
    {
      "parameters": {
        "httpMethod": "POST",
        "path": "boda-rsvp",
        "responseMode": "responseNode",
        "options": {}
      },
      "id": "a1b2c3d4-0001-4000-8000-000000000001",
      "name": "Webhook RSVP",
      "type": "n8n-nodes-base.webhook",
      "typeVersion": 2,
      "position": [250, 100],
      "webhookId": "a1b2c3d4-0001-4000-8000-000000000001"
    },
    {
      "parameters": {
        "mode": "runOnceForEachItem",
        "language": "javaScript",
        "jsCode": "const body = $json.body || {};\nconst nombre = (body.nombre || '').toString().trim();\nconst asiste = body.asiste === true || body.asiste === 'true' || body.asiste === 'si';\nconst acompanantes = asiste ? Math.max(0, parseInt(body.acompanantes, 10) || 0) : 0;\nconst nombresAcompanantes = asiste && Array.isArray(body.nombres_acompanantes)\n  ? body.nombres_acompanantes.map(n => String(n).trim()).filter(Boolean)\n  : [];\n\nconst entry = {\n  timestamp: new Date().toISOString(),\n  nombre,\n  asiste,\n  acompanantes,\n  nombres_acompanantes: nombresAcompanantes\n};\n\nreturn { json: { line: JSON.stringify(entry) + '\\n' } };"
      },
      "id": "a1b2c3d4-0001-4000-8000-000000000002",
      "name": "Preparar Línea RSVP",
      "type": "n8n-nodes-base.code",
      "typeVersion": 2,
      "position": [500, 100]
    },
    {
      "parameters": {
        "mode": "jsonToBinary",
        "convertAllData": false,
        "sourceKey": "line",
        "options": {}
      },
      "id": "a1b2c3d4-0001-4000-8000-000000000003",
      "name": "JSON a Binario RSVP",
      "type": "n8n-nodes-base.moveBinaryData",
      "typeVersion": 1,
      "position": [750, 100]
    },
    {
      "parameters": {
        "operation": "write",
        "fileName": "/data/boda-rsvp.jsonl",
        "dataPropertyName": "data",
        "options": { "append": true }
      },
      "id": "a1b2c3d4-0001-4000-8000-000000000004",
      "name": "Guardar RSVP",
      "type": "n8n-nodes-base.readWriteFile",
      "typeVersion": 1,
      "position": [1000, 100]
    },
    {
      "parameters": {
        "respondWith": "json",
        "responseBody": "={{ { \"ok\": true } }}",
        "options": {}
      },
      "id": "a1b2c3d4-0001-4000-8000-000000000005",
      "name": "Responder RSVP",
      "type": "n8n-nodes-base.respondToWebhook",
      "typeVersion": 1.1,
      "position": [1250, 100]
    },
    {
      "parameters": {
        "httpMethod": "POST",
        "path": "boda-alergenos",
        "responseMode": "responseNode",
        "options": {}
      },
      "id": "a1b2c3d4-0002-4000-8000-000000000001",
      "name": "Webhook Alergias",
      "type": "n8n-nodes-base.webhook",
      "typeVersion": 2,
      "position": [250, 300],
      "webhookId": "a1b2c3d4-0002-4000-8000-000000000001"
    },
    {
      "parameters": {
        "mode": "runOnceForEachItem",
        "language": "javaScript",
        "jsCode": "const body = $json.body || {};\nconst nombre_persona = (body.nombre_persona || '').toString().trim();\nconst tipos = Array.isArray(body.tipos) ? body.tipos.map(t => String(t).trim()).filter(Boolean) : [];\nconst detalle = (body.detalle || '').toString().trim();\n\nconst entry = {\n  timestamp: new Date().toISOString(),\n  nombre_persona,\n  tipos,\n  detalle\n};\n\nreturn { json: { line: JSON.stringify(entry) + '\\n' } };"
      },
      "id": "a1b2c3d4-0002-4000-8000-000000000002",
      "name": "Preparar Línea Alergias",
      "type": "n8n-nodes-base.code",
      "typeVersion": 2,
      "position": [500, 300]
    },
    {
      "parameters": {
        "mode": "jsonToBinary",
        "convertAllData": false,
        "sourceKey": "line",
        "options": {}
      },
      "id": "a1b2c3d4-0002-4000-8000-000000000003",
      "name": "JSON a Binario Alergias",
      "type": "n8n-nodes-base.moveBinaryData",
      "typeVersion": 1,
      "position": [750, 300]
    },
    {
      "parameters": {
        "operation": "write",
        "fileName": "/data/boda-alergenos.jsonl",
        "dataPropertyName": "data",
        "options": { "append": true }
      },
      "id": "a1b2c3d4-0002-4000-8000-000000000004",
      "name": "Guardar Alergias",
      "type": "n8n-nodes-base.readWriteFile",
      "typeVersion": 1,
      "position": [1000, 300]
    },
    {
      "parameters": {
        "respondWith": "json",
        "responseBody": "={{ { \"ok\": true } }}",
        "options": {}
      },
      "id": "a1b2c3d4-0002-4000-8000-000000000005",
      "name": "Responder Alergias",
      "type": "n8n-nodes-base.respondToWebhook",
      "typeVersion": 1.1,
      "position": [1250, 300]
    },
    {
      "parameters": {
        "httpMethod": "GET",
        "path": "boda-admin",
        "responseMode": "responseNode",
        "authentication": "basicAuth",
        "options": {}
      },
      "id": "a1b2c3d4-0003-4000-8000-000000000001",
      "name": "Webhook Admin",
      "type": "n8n-nodes-base.webhook",
      "typeVersion": 2,
      "position": [250, 550],
      "webhookId": "a1b2c3d4-0003-4000-8000-000000000001"
    },
    {
      "parameters": {
        "operation": "read",
        "fileSelector": "/data/boda-rsvp.jsonl",
        "options": {}
      },
      "id": "a1b2c3d4-0003-4000-8000-000000000002",
      "name": "Leer RSVP",
      "type": "n8n-nodes-base.readWriteFile",
      "typeVersion": 1,
      "position": [500, 480],
      "continueOnFail": true
    },
    {
      "parameters": {
        "operation": "read",
        "fileSelector": "/data/boda-alergenos.jsonl",
        "options": {}
      },
      "id": "a1b2c3d4-0003-4000-8000-000000000003",
      "name": "Leer Alergias",
      "type": "n8n-nodes-base.readWriteFile",
      "typeVersion": 1,
      "position": [500, 620],
      "continueOnFail": true
    },
    {
      "parameters": {
        "mode": "runOnceForAllItems",
        "language": "javaScript",
        "jsCode": "function decodeBinaryText(nodeName) {\n  try {\n    const item = $(nodeName).item;\n    if (!item || !item.binary || !item.binary.data) return '';\n    return Buffer.from(item.binary.data.data, 'base64').toString('utf-8');\n  } catch (e) {\n    return '';\n  }\n}\n\nfunction parseJsonl(text) {\n  return text.split('\\n').map(l => l.trim()).filter(Boolean).map(l => {\n    try { return JSON.parse(l); } catch (e) { return null; }\n  }).filter(Boolean);\n}\n\nfunction escapeHtml(str) {\n  return String(str).replace(/[&<>\"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','\"':'&quot;',\"'\":'&#39;'}[c]));\n}\n\nconst rsvp = parseJsonl(decodeBinaryText('Leer RSVP'));\nconst alergenos = parseJsonl(decodeBinaryText('Leer Alergias'));\n\nconst rsvpRows = rsvp.map(r => `\n  <tr>\n    <td>${escapeHtml(r.timestamp || '')}</td>\n    <td>${escapeHtml(r.nombre || '')}</td>\n    <td>${r.asiste ? 'Sí' : 'No'}</td>\n    <td>${escapeHtml(r.acompanantes ?? 0)}</td>\n    <td>${escapeHtml((r.nombres_acompanantes || []).join(', '))}</td>\n  </tr>`).join('');\n\nconst alergenosRows = alergenos.map(a => `\n  <tr>\n    <td>${escapeHtml(a.timestamp || '')}</td>\n    <td>${escapeHtml(a.nombre_persona || '')}</td>\n    <td>${escapeHtml((a.tipos || []).join(', '))}</td>\n    <td>${escapeHtml(a.detalle || '')}</td>\n  </tr>`).join('');\n\nconst html = `<!DOCTYPE html>\n<html lang=\"es\">\n<head>\n<meta charset=\"UTF-8\">\n<title>Dashboard · Boda Gloria y José</title>\n<style>\n  body { font-family: Arial, sans-serif; background: #ebe6da; color: #231f1a; padding: 2rem; }\n  h1 { font-family: Georgia, serif; color: #1a382b; }\n  h2 { color: #9e773b; margin-top: 2.5rem; }\n  table { width: 100%; border-collapse: collapse; background: #fbf9f4; border-radius: 10px; overflow: hidden; }\n  th, td { padding: 0.6rem 0.9rem; border-bottom: 1px solid rgba(201,160,99,0.35); text-align: left; font-size: 0.9rem; }\n  th { background: #1a382b; color: #e2c290; text-transform: uppercase; font-size: 0.75rem; letter-spacing: 0.05em; }\n  tr:last-child td { border-bottom: none; }\n</style>\n</head>\n<body>\n  <h1>Gloria &amp; José — Dashboard</h1>\n\n  <h2>Confirmaciones de asistencia (${rsvp.length})</h2>\n  <table>\n    <thead><tr><th>Fecha</th><th>Nombre</th><th>Asiste</th><th>Acompañantes</th><th>Nombres acompañantes</th></tr></thead>\n    <tbody>${rsvpRows || '<tr><td colspan=\"5\">Sin confirmaciones todavía.</td></tr>'}</tbody>\n  </table>\n\n  <h2>Alergias e intolerancias (${alergenos.length})</h2>\n  <table>\n    <thead><tr><th>Fecha</th><th>Persona</th><th>Tipos</th><th>Detalle</th></tr></thead>\n    <tbody>${alergenosRows || '<tr><td colspan=\"4\">Sin avisos todavía.</td></tr>'}</tbody>\n  </table>\n</body>\n</html>`;\n\nreturn [{ json: { html } }];"
      },
      "id": "a1b2c3d4-0003-4000-8000-000000000004",
      "name": "Generar Dashboard HTML",
      "type": "n8n-nodes-base.code",
      "typeVersion": 2,
      "position": [750, 550]
    },
    {
      "parameters": {
        "respondWith": "text",
        "responseBody": "={{ $json.html }}",
        "options": {
          "responseHeaders": {
            "entries": [
              { "name": "Content-Type", "value": "text/html; charset=utf-8" }
            ]
          }
        }
      },
      "id": "a1b2c3d4-0003-4000-8000-000000000005",
      "name": "Responder Admin",
      "type": "n8n-nodes-base.respondToWebhook",
      "typeVersion": 1.1,
      "position": [1000, 550]
    }
  ],
  "connections": {
    "Webhook RSVP": { "main": [[{ "node": "Preparar Línea RSVP", "type": "main", "index": 0 }]] },
    "Preparar Línea RSVP": { "main": [[{ "node": "JSON a Binario RSVP", "type": "main", "index": 0 }]] },
    "JSON a Binario RSVP": { "main": [[{ "node": "Guardar RSVP", "type": "main", "index": 0 }]] },
    "Guardar RSVP": { "main": [[{ "node": "Responder RSVP", "type": "main", "index": 0 }]] },

    "Webhook Alergias": { "main": [[{ "node": "Preparar Línea Alergias", "type": "main", "index": 0 }]] },
    "Preparar Línea Alergias": { "main": [[{ "node": "JSON a Binario Alergias", "type": "main", "index": 0 }]] },
    "JSON a Binario Alergias": { "main": [[{ "node": "Guardar Alergias", "type": "main", "index": 0 }]] },
    "Guardar Alergias": { "main": [[{ "node": "Responder Alergias", "type": "main", "index": 0 }]] },

    "Webhook Admin": {
      "main": [[
        { "node": "Leer RSVP", "type": "main", "index": 0 },
        { "node": "Leer Alergias", "type": "main", "index": 0 }
      ]]
    },
    "Leer RSVP": { "main": [[{ "node": "Generar Dashboard HTML", "type": "main", "index": 0 }]] },
    "Leer Alergias": { "main": [[{ "node": "Generar Dashboard HTML", "type": "main", "index": 0 }]] },
    "Generar Dashboard HTML": { "main": [[{ "node": "Responder Admin", "type": "main", "index": 0 }]] }
  },
  "active": false,
  "settings": { "executionOrder": "v1" },
  "pinData": {}
}
```

- [ ] **Step 2: Comprobar que el JSON es válido**

Run: `python -m json.tool "n8n/boda-formularios.workflow.json" > /dev/null && echo "valid json"`
Expected: `valid json` (sin errores de parseo).

- [ ] **Step 3: Crear la guía de configuración post-import**

Crea el archivo `n8n/SETUP.md` con este contenido exacto:

```markdown
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
- Contraseña: `HaciendaGJ-27!`

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

## 6. Probar el dashboard

Abre `https://n8n.ivangonzalez.cloud/webhook/boda-admin` en el navegador,
introduce el usuario/contraseña del paso 3, y confirma que aparecen las dos
filas de prueba en sus tablas.

## 7. Si algo no encaja

Si al importar algún nodo aparece marcado en rojo con un error del tipo
"parámetro no reconocido" o similar, es que tu versión de n8n difiere de la
esperada en ese nodo (probablemente "Read/Write Files from Disk" o "Move
Binary Data", que han cambiado de forma entre versiones). Anota qué nodo y
qué mensaje de error da exactamente, para poder ajustarlo.

## 8. Limpieza después de la boda

Cuando ya no haga falta nada de esto: desactiva el workflow, bórralo, y
borra los dos archivos `.jsonl` del disco de n8n.
```

- [ ] **Step 4: Commit**

```bash
git add n8n/boda-formularios.workflow.json n8n/SETUP.md
git commit -m "Añade workflow de n8n para RSVP/alergias y guía de configuración"
```
