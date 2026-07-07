function qs(id) { return document.getElementById(id); }

function getAccessToken() {
  return localStorage.getItem("astebook_ui_token") || "";
}

async function apiFetch(url, options = {}) {
  const headers = { ...(options.headers || {}) };
  const token = getAccessToken();
  if (token) headers["x-astebook-token"] = token;
  const resp = await fetch(url, { ...options, headers, credentials: 'same-origin' });
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
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initAdminClient);
} else {
  initAdminClient();
}
