function qs(id) { return document.getElementById(id); }

function getAccessToken() {
  return localStorage.getItem("astebook_ui_token") || "";
}

async function apiFetch(url, options = {}) {
  const headers = { ...(options.headers || {}) };
  const token = getAccessToken();
  if (token) headers["x-astebook-token"] = token;
  let resp = await fetch(url, { ...options, headers, credentials: 'same-origin' });
  if (resp.status === 401) {
    const newToken = window.prompt("Token UI Astebook") || "";
    if (newToken) {
      localStorage.setItem("astebook_ui_token", newToken);
      headers["x-astebook-token"] = newToken;
      resp = await fetch(url, { ...options, headers, credentials: 'same-origin' });
    }
  }
  return resp;
}

async function loadSettings() {
  try {
    const resp = await apiFetch('/api/v1/admin/settings?reveal=1');
    if (!resp.ok) throw new Error('Unable to fetch settings');
    const data = await resp.json();
    const settings = data.settings || {};
    // Map values into inputs
    Object.entries(settings).forEach(([key, val]) => {
      const id = {
        processing_ui_token: 'processingUiToken',
        zapier_webhook_token: 'zapierWebhookToken',
        admin_session_secret: 'adminSessionSecret',
        ai_api_key: 'aiApiKey',
        ai_base_url: 'aiBaseUrl',
        ai_model: 'aiModel',
        pdf_app_api_key: 'pdfAppApiKey',
        pdf_app_ocr_endpoint: 'pdfAppOcrEndpoint',
        pdf_app_job_endpoint: 'pdfAppJobEndpoint',
        document_template_url: 'documentTemplateUrl',
      }[key];
      if (id) qs(id).value = val || '';
    });
    // After loading, update model suggestion based on base URL
    suggestModelBasedOnBaseUrl();
  } catch (err) {
    console.error('loadSettings', err);
  }
}

let allEvents = [];

async function loadEvents() {
  try {
    const resp = await apiFetch('/api/v1/processing-events');
    if (!resp.ok) {
      console.warn('Failed to load events', resp.status);
      return;
    }
    const data = await resp.json();
    allEvents = data.events || [];
    renderEventList();
    if (allEvents.length) selectEvent(allEvents[0].id);
  } catch (err) {
    console.error('loadEvents', err);
  }
}

function renderEventList() {
  const container = document.getElementById('eventList');
  if (!container) return;
  container.innerHTML = '';
  for (const ev of allEvents) {
    const title = ev.metadata?.subject || ev.metadata?.email_id || ev.metadata?.zap_run_id || ev.id;
    const el = document.createElement('button');
    el.type = 'button';
    el.className = 'event-item';
    el.textContent = `${title} — ${ev.status || ''}`;
    el.dataset.eventId = ev.id;
    el.addEventListener('click', () => selectEvent(ev.id));
    container.appendChild(el);
  }
}

function formatJson(value) {
  if (value === null || value === undefined) return '-';
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

function formatFiles(files) {
  if (!Array.isArray(files) || files.length === 0) return '-';
  return files
    .map((file) => `• ${file.originalname || file.file_name || file.fieldname || 'file'} (${file.mimetype || file.mime_type || 'unknown'}, ${file.size ?? 'n/a'})`)
    .join('\n');
}

function formatSteps(steps) {
  if (!Array.isArray(steps) || steps.length === 0) return '-';
  return steps
    .map((step) => `• [${step.level}] ${step.message || ''}${step.data ? `\n  ${JSON.stringify(step.data, null, 2)}` : ''}`)
    .join('\n\n');
}

function formatNotes(ev) {
  const notes = [];
  if (ev.error?.message) notes.push(`Errore: ${ev.error.message}`);
  if (Array.isArray(ev.error?.missing_fields) && ev.error.missing_fields.length) {
    notes.push(`Missing fields:\n${ev.error.missing_fields.map((field) => `- ${field.message || field.field || JSON.stringify(field)}`).join('\n')}`);
  }
  if (Array.isArray(ev.steps)) {
    const infos = ev.steps.filter((step) => step.level !== 'info' || /warning|error/i.test(step.level));
    if (infos.length) {
      notes.push(`Step notes:\n${infos.map((step) => `- ${step.level}: ${step.message || ''}`).join('\n')}`);
    }
  }
  if (notes.length === 0 && ev.result?.notes) {
    notes.push(`Notes:\n${JSON.stringify(ev.result.notes, null, 2)}`);
  }
  return notes.length ? notes.join('\n\n') : '-';
}

async function selectEvent(id) {
  try {
    const resp = await apiFetch(`/api/v1/processing-events/${id}`);
    if (!resp.ok) {
      console.warn('Failed to load event', resp.status);
      return;
    }
    const data = await resp.json();
    const ev = data.event;
    if (!ev) return;
    document.getElementById('selectedTitle').textContent = ev.metadata?.subject || ev.id;
    document.getElementById('selectedSource').textContent = ev.source || '-';
    document.getElementById('selectedStatus').textContent = ev.status || '-';
    document.getElementById('receivedAt').textContent = ev.received_at || '-';
    document.getElementById('updatedAt').textContent = ev.updated_at || '-';
    document.getElementById('fileCount').textContent = Array.isArray(ev.request?.files) ? ev.request.files.length : '-';

    document.getElementById('requestPane').textContent = formatJson(ev.request || {});
    document.getElementById('stepsPane').textContent = formatSteps(ev.steps);
    document.getElementById('filesPane').textContent = formatFiles(ev.request?.files);
    document.getElementById('resultPane').textContent = formatJson(ev.result || {});
    document.getElementById('missingFieldsPane').textContent =
      formatJson(ev.error?.missing_fields || ev.result?.missing_fields || []);
    document.getElementById('notesPane').textContent = formatNotes(ev);

    const reprocessButton = document.getElementById('reprocessButton');
    const documentButton = document.getElementById('documentButton');
    const canReprocess = ev.source === 'zapier.email_activation';
    reprocessButton.disabled = !canReprocess;
    documentButton.disabled = false;
    reprocessButton.onclick = async () => {
      try {
        const res = await apiFetch(`/api/v1/processing-events/${id}/reprocess`, { method: 'POST' });
        if (!res.ok) {
          console.warn('Reprocess failed', res.status);
          return;
        }
        await selectEvent(id);
      } catch (error) {
        console.error('reprocess failed', error);
      }
    };
    documentButton.onclick = () => {
      window.open(`/api/v1/processing-events/${id}/document?format=pdf`, '_blank', 'noopener');
    };
  } catch (err) {
    console.error('selectEvent', err);
  }
}

function initRevealButtons() {
  document.querySelectorAll('.reveal-button').forEach((btn) => {
    btn.addEventListener('click', () => {
      const targetId = btn.dataset.reveal;
      const inp = qs(targetId);
      if (!inp) return;
      inp.type = inp.type === 'password' ? 'text' : 'password';
    });
  });
}

function suggestModelBasedOnBaseUrl() {
  const baseInput = qs('aiBaseUrl');
  const modelInput = qs('aiModel');
  if (!baseInput || !modelInput) return;
  const base = String(baseInput.value || '').toLowerCase();

  let hint = qs('aiModelHint');
  if (!hint) {
    hint = document.createElement('div');
    hint.id = 'aiModelHint';
    hint.style.fontSize = '12px';
    hint.style.color = '#647084';
    hint.style.marginTop = '6px';
    modelInput.parentNode.appendChild(hint);
  }

  if (base.includes('openrouter')) {
    // If user hasn't provided a custom model or has a provider prefix, suggest the OpenRouter-friendly model
    if (!modelInput.value || modelInput.value.startsWith('openai/')) {
      modelInput.value = modelInput.value && modelInput.value.startsWith('openai/')
        ? modelInput.value.replace(/^openai\//, '')
        : 'gpt-4o-mini';
    }
    hint.textContent = 'Suggerimento: OpenRouter usa il modello senza prefisso provider (es. "gpt-4o-mini").';
  } else {
    hint.textContent = '';
  }
}

async function saveSettings(e) {
  e.preventDefault();
  const form = qs('settingsForm');
  const formData = new FormData(form);
  const body = {};
  for (const [k, v] of formData.entries()) {
    body[k] = v;
  }
  try {
    const resp = await apiFetch('/api/v1/admin/settings', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    const data = await resp.json();
    qs('settingsStatus').textContent = data.ok ? 'Salvato' : `Errore: ${data.error || 'unknown'}`;
    setTimeout(() => { qs('settingsStatus').textContent = ''; }, 3000);
    await loadSettings();
  } catch (err) {
    qs('settingsStatus').textContent = 'Errore salvataggio';
    console.error('saveSettings', err);
  }
}

export default function initAdminClient() {
  document.getElementById('settingsButton').addEventListener('click', () => {
    qs('settingsModal').hidden = false;
  });
  document.getElementById('closeSettingsButton').addEventListener('click', () => {
    qs('settingsModal').hidden = true;
  });
  initRevealButtons();
  qs('settingsForm').addEventListener('submit', saveSettings);
  // react to base URL changes to suggest model
  const baseInput = qs('aiBaseUrl');
  if (baseInput) baseInput.addEventListener('input', suggestModelBasedOnBaseUrl);
  loadSettings();
  loadEvents();
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initAdminClient);
} else {
  initAdminClient();
}
