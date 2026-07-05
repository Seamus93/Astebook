const eventList = document.querySelector("#eventList");
const refreshButton = document.querySelector("#refreshButton");
const documentButton = document.querySelector("#documentButton");
const settingsButton = document.querySelector("#settingsButton");
const closeSettingsButton = document.querySelector("#closeSettingsButton");
const settingsModal = document.querySelector("#settingsModal");
const selectedSource = document.querySelector("#selectedSource");
const selectedTitle = document.querySelector("#selectedTitle");
const selectedStatus = document.querySelector("#selectedStatus");
const receivedAt = document.querySelector("#receivedAt");
const updatedAt = document.querySelector("#updatedAt");
const fileCount = document.querySelector("#fileCount");
const requestPane = document.querySelector("#requestPane");
const stepsPane = document.querySelector("#stepsPane");
const resultPane = document.querySelector("#resultPane");
const errorPane = document.querySelector("#errorPane");
const settingsForm = document.querySelector("#settingsForm");
const settingsPane = document.querySelector("#settingsPane");
const settingsStatus = document.querySelector("#settingsStatus");
const processingUiToken = document.querySelector("#processingUiToken");
const zapierWebhookToken = document.querySelector("#zapierWebhookToken");
const adminSessionSecret = document.querySelector("#adminSessionSecret");
const adminPassword = document.querySelector("#adminPassword");

const secretInputs = {
  processing_ui_token: processingUiToken,
  zapier_webhook_token: zapierWebhookToken,
  admin_session_secret: adminSessionSecret,
};

const inputSecrets = {
  processingUiToken: "processing_ui_token",
  zapierWebhookToken: "zapier_webhook_token",
  adminSessionSecret: "admin_session_secret",
};

let selectedId = null;
let isLoadingEvent = false;
let accessToken = localStorage.getItem("astebook_ui_token") || "";
let revealedSettings = null;

async function apiFetch(url, options = {}) {
  const headers = {
    ...(options.headers || {}),
    ...(accessToken ? { "x-astebook-token": accessToken } : {}),
  };
  const response = await fetch(url, { ...options, headers });
  if (response.status === 401) {
    accessToken = window.prompt("Token UI Astebook") || "";
    localStorage.setItem("astebook_ui_token", accessToken);
    return apiFetch(url, options);
  }
  return response;
}

function formatDate(value) {
  return value ? new Date(value).toLocaleString("it-IT") : "-";
}

function titleFor(event) {
  return event.metadata?.subject || event.metadata?.email_id || event.metadata?.zap_run_id || event.id;
}

function labelFor(key) {
  return String(key)
    .replace(/_/g, " ")
    .replace(/\b\w/g, (char) => char.toUpperCase());
}

function isPlainObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function primitiveText(value) {
  if (value === null || value === undefined || value === "") return "-";
  if (typeof value === "boolean") return value ? "Si" : "No";
  return String(value);
}

function appendValue(container, key, value) {
  if (Array.isArray(value)) {
    const details = document.createElement("details");
    details.className = "data-section";
    details.open = value.length <= 3;

    const summary = document.createElement("summary");
    summary.textContent = `${labelFor(key)} (${value.length})`;
    details.append(summary);

    if (value.length === 0) {
      const empty = document.createElement("p");
      empty.className = "empty-state";
      empty.textContent = "Nessun valore.";
      details.append(empty);
    } else {
      value.forEach((item, index) => appendValue(details, `${key} ${index + 1}`, item));
    }

    container.append(details);
    return;
  }

  if (isPlainObject(value)) {
    const details = document.createElement("details");
    details.className = "data-section";
    details.open = true;

    const summary = document.createElement("summary");
    summary.textContent = labelFor(key);
    details.append(summary);

    const list = document.createElement("div");
    list.className = "kv-list";
    Object.entries(value).forEach(([childKey, childValue]) => {
      if (isPlainObject(childValue) || Array.isArray(childValue)) {
        appendValue(details, childKey, childValue);
        return;
      }

      const row = document.createElement("div");
      row.className = "kv-row";
      const keyEl = document.createElement("div");
      keyEl.className = "kv-key";
      keyEl.textContent = labelFor(childKey);
      const valueEl = document.createElement("div");
      valueEl.className = "kv-value";
      valueEl.textContent = primitiveText(childValue);
      row.append(keyEl, valueEl);
      list.append(row);
    });
    details.append(list);
    container.append(details);
    return;
  }

  const row = document.createElement("div");
  row.className = "kv-row";
  const keyEl = document.createElement("div");
  keyEl.className = "kv-key";
  keyEl.textContent = labelFor(key);
  const valueEl = document.createElement("div");
  valueEl.className = "kv-value";
  valueEl.textContent = primitiveText(value);
  row.append(keyEl, valueEl);
  container.append(row);
}

function renderStructured(container, value, emptyLabel) {
  container.innerHTML = "";
  const isEmpty =
    value === null ||
    value === undefined ||
    value === "" ||
    (Array.isArray(value) && value.length === 0) ||
    (isPlainObject(value) && Object.keys(value).length === 0);

  if (isEmpty) {
    const empty = document.createElement("p");
    empty.className = "empty-state";
    empty.textContent = emptyLabel;
    container.append(empty);
    return;
  }

  if (isPlainObject(value)) {
    Object.entries(value).forEach(([key, childValue]) => appendValue(container, key, childValue));
    return;
  }

  appendValue(container, "Valore", value);
}

function renderSettingsSummary(payload) {
  settingsPane.innerHTML = "";
  const settings = payload.settings || {};
  const rows = [
    ["Utente admin", payload.admin?.username || "-"],
    ["Auth gestita da env", payload.admin?.env_managed ? "Si" : "No"],
    ["Token UI", settings.processing_ui_token || "-"],
    ["Token Webhook Zapier", settings.zapier_webhook_token || "-"],
    ["Session Secret", settings.admin_session_secret || "-"],
  ];

  rows.forEach(([label, value]) => {
    const card = document.createElement("div");
    card.className = "setting-card";
    const labelEl = document.createElement("strong");
    labelEl.textContent = label;
    const valueEl = document.createElement("span");
    valueEl.textContent = value;
    card.append(labelEl, valueEl);
    settingsPane.append(card);
  });
}

function applySettingPlaceholders(settings) {
  Object.entries(secretInputs).forEach(([key, input]) => {
    if (!input) return;
    input.placeholder = settings[key] || input.getAttribute("placeholder") || "";
  });
}

async function loadSettings({ reveal = false } = {}) {
  const response = await apiFetch(`/api/v1/admin/settings${reveal ? "?reveal=1" : ""}`);
  const data = await response.json();
  if (reveal) revealedSettings = data.settings || {};
  if (!reveal) applySettingPlaceholders(data.settings || {});
  renderSettingsSummary(data);
  return data;
}

function setRevealState(input, button, isVisible) {
  input.type = isVisible ? "text" : "password";
  const icon = button.querySelector(".material-symbols-outlined");
  if (icon) icon.textContent = isVisible ? "visibility_off" : "visibility";
  button.title = isVisible ? "Nascondi" : "Mostra";
}

async function revealInput(button) {
  const input = document.querySelector(`#${button.dataset.reveal}`);
  if (!input) return;

  const isVisible = input.type === "text";
  if (isVisible) {
    setRevealState(input, button, false);
    return;
  }

  const secretKey = inputSecrets[input.id];
  if (secretKey && !input.value) {
    if (!revealedSettings) await loadSettings({ reveal: true });
    input.value = revealedSettings?.[secretKey] || "";
  }

  setRevealState(input, button, true);
}

function openSettings() {
  settingsModal.hidden = false;
  loadSettings();
}

function closeSettings() {
  settingsModal.hidden = true;
}

async function loadEvents() {
  const response = await apiFetch("/api/v1/processing-events");
  const data = await response.json();
  eventList.innerHTML = "";

  data.events.forEach((event) => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = `event-item${event.id === selectedId ? " active" : ""}`;

    const title = document.createElement("strong");
    title.textContent = titleFor(event);
    const meta = document.createElement("span");
    meta.textContent = `${event.status} - ${formatDate(event.received_at)}`;
    button.append(title, meta);

    button.addEventListener("click", () => loadEvent(event.id));
    eventList.appendChild(button);
  });

  if (!selectedId && data.events[0] && !isLoadingEvent) {
    await loadEvent(data.events[0].id);
  }
}

async function loadEvent(id) {
  isLoadingEvent = true;
  selectedId = id;
  documentButton.disabled = false;
  const response = await apiFetch(`/api/v1/processing-events/${id}`);
  const data = await response.json();
  const event = data.event;

  selectedSource.textContent = event.source;
  selectedTitle.textContent = titleFor(event);
  selectedStatus.textContent = event.status;
  selectedStatus.className = `status ${event.status}`;
  receivedAt.textContent = formatDate(event.received_at);
  updatedAt.textContent = formatDate(event.updated_at);
  fileCount.textContent = event.request?.files?.length || 0;
  renderStructured(requestPane, event.request, "Nessun payload ricevuto.");
  renderStructured(resultPane, event.result, "Nessun dato estratto.");
  renderStructured(errorPane, event.error, "Nessun errore.");

  stepsPane.innerHTML = "";
  if (!event.steps?.length) {
    const empty = document.createElement("p");
    empty.className = "empty-state";
    empty.textContent = "Nessuno step registrato.";
    stepsPane.append(empty);
  }

  (event.steps || []).forEach((step) => {
    const item = document.createElement("div");
    item.className = `step ${step.level === "error" ? "error" : ""}`;

    const message = document.createElement("strong");
    message.textContent = step.message;
    const date = document.createElement("span");
    date.textContent = formatDate(step.at);
    item.append(message, date);

    if (step.data) {
      const dataContainer = document.createElement("div");
      dataContainer.className = "step-data";
      renderStructured(dataContainer, step.data, "Nessun dettaglio.");
      item.append(dataContainer);
    }

    stepsPane.appendChild(item);
  });

  isLoadingEvent = false;
  await loadEvents();
}

refreshButton.addEventListener("click", loadEvents);
documentButton.addEventListener("click", () => {
  if (!selectedId) return;
  window.open(`/api/v1/processing-events/${selectedId}/document?format=pdf`, "_blank", "noopener");
});
settingsButton.addEventListener("click", openSettings);
closeSettingsButton.addEventListener("click", closeSettings);
settingsModal.addEventListener("click", (event) => {
  if (event.target === settingsModal) closeSettings();
});

document.querySelectorAll(".reveal-button").forEach((button) => {
  button.addEventListener("click", () => revealInput(button));
});

settingsForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  settingsStatus.textContent = "Salvataggio...";

  const payload = {
    processing_ui_token: processingUiToken.value.trim(),
    zapier_webhook_token: zapierWebhookToken.value.trim(),
    admin_session_secret: adminSessionSecret.value.trim(),
    admin_password: adminPassword.value,
  };

  const response = await apiFetch("/api/v1/admin/settings", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload),
  });
  if (response.ok) {
    processingUiToken.value = "";
    zapierWebhookToken.value = "";
    adminSessionSecret.value = "";
    adminPassword.value = "";
    revealedSettings = null;
    settingsStatus.textContent = "Impostazioni salvate.";
    await loadSettings();
    return;
  }

  settingsStatus.textContent = "Errore durante il salvataggio.";
});

loadEvents();
loadSettings();
