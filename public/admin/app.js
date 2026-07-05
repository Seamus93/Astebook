const eventList = document.querySelector("#eventList");
const refreshButton = document.querySelector("#refreshButton");
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

let selectedId = null;
let isLoadingEvent = false;
let accessToken = localStorage.getItem("astebook_ui_token") || "";

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

async function loadSettings() {
  const response = await apiFetch("/api/v1/admin/settings");
  const data = await response.json();
  settingsPane.textContent = formatJson(data);
}

function formatJson(value) {
  return JSON.stringify(value || {}, null, 2);
}

function formatDate(value) {
  return value ? new Date(value).toLocaleString("it-IT") : "-";
}

function titleFor(event) {
  return event.metadata?.subject || event.metadata?.email_id || event.metadata?.zap_run_id || event.id;
}

async function loadEvents() {
  const response = await apiFetch("/api/v1/processing-events");
  const data = await response.json();
  eventList.innerHTML = "";

  data.events.forEach((event) => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = `event-item${event.id === selectedId ? " active" : ""}`;
    button.innerHTML = `
      <strong>${titleFor(event)}</strong>
      <span>${event.status} - ${formatDate(event.received_at)}</span>
    `;
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
  requestPane.textContent = formatJson(event.request);
  resultPane.textContent = formatJson(event.result);
  errorPane.textContent = formatJson(event.error);

  stepsPane.innerHTML = "";
  (event.steps || []).forEach((step) => {
    const item = document.createElement("div");
    item.className = `step ${step.level === "error" ? "error" : ""}`;
    item.innerHTML = `
      <strong>${step.message}</strong>
      <span>${formatDate(step.at)}</span>
      ${step.data ? `<pre>${formatJson(step.data)}</pre>` : ""}
    `;
    stepsPane.appendChild(item);
  });

  isLoadingEvent = false;
  await loadEvents();
}

refreshButton.addEventListener("click", loadEvents);
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
    settingsStatus.textContent = "Impostazioni salvate.";
    await loadSettings();
    return;
  }

  settingsStatus.textContent = "Errore durante il salvataggio.";
});

loadEvents();
loadSettings();
