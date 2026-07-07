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
    document.getElementById('fileCount').textContent = Array.isArray(ev.files) ? ev.files.length : '-';
    const reqPane = document.getElementById('requestPane');
    reqPane.textContent = JSON.stringify(ev.request || {}, null, 2);
    const resultPane = document.getElementById('resultPane');
    resultPane.textContent = JSON.stringify(ev.result || {}, null, 2);
    const missingPane = document.getElementById('missingFieldsPane');
    missingPane.textContent = JSON.stringify(ev.missing_fields || [], null, 2);
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
