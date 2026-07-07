const eventList = document.querySelector("#eventList");
const refreshButton = document.querySelector("#refreshButton");
const notificationsButton = document.querySelector("#notificationsButton");
const notificationsCount = document.querySelector("#notificationsCount");
const closeNotificationsButton = document.querySelector("#closeNotificationsButton");
const notificationsModal = document.querySelector("#notificationsModal");
const notificationsPane = document.querySelector("#notificationsPane");
const eventSearchInput = document.querySelector("#eventSearchInput");
const filtersButton = document.querySelector("#filtersButton");
const closeFiltersButton = document.querySelector("#closeFiltersButton");
const filtersModal = document.querySelector("#filtersModal");
const filtersForm = document.querySelector("#filtersForm");
const resetFiltersButton = document.querySelector("#resetFiltersButton");
const filterStatus = document.querySelector("#filterStatus");
const filterProcedure = document.querySelector("#filterProcedure");
const filterProponente = document.querySelector("#filterProponente");
const filterAzienda = document.querySelector("#filterAzienda");
const filterEmail = document.querySelector("#filterEmail");
const filterDateFrom = document.querySelector("#filterDateFrom");
const filterDateTo = document.querySelector("#filterDateTo");
const filterHasError = document.querySelector("#filterHasError");
const filterHasFiles = document.querySelector("#filterHasFiles");
const documentButton = document.querySelector("#documentButton");
const reprocessButton = document.querySelector("#reprocessButton");
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
const filesPane = document.querySelector("#filesPane");
const resultPane = document.querySelector("#resultPane");
const notesPane = document.querySelector("#notesPane");
const missingFieldsPane = document.querySelector("#missingFieldsPane");
const errorPane = document.querySelector("#errorPane");
const settingsForm = document.querySelector("#settingsForm");
const settingsPane = document.querySelector("#settingsPane");
const settingsStatus = document.querySelector("#settingsStatus");
const processingUiToken = document.querySelector("#processingUiToken");
const zapierWebhookToken = document.querySelector("#zapierWebhookToken");
const adminSessionSecret = document.querySelector("#adminSessionSecret");
const pdfAppApiKey = document.querySelector("#pdfAppApiKey");
const pdfAppOcrEndpoint = document.querySelector("#pdfAppOcrEndpoint");
const pdfAppJobEndpoint = document.querySelector("#pdfAppJobEndpoint");
const documentTemplateUrl = document.querySelector("#documentTemplateUrl");
const adminPassword = document.querySelector("#adminPassword");
const panelStorageKey = "astebook_collapsed_panels";

const secretInputs = {
  processing_ui_token: processingUiToken,
  zapier_webhook_token: zapierWebhookToken,
  admin_session_secret: adminSessionSecret,
  pdf_app_api_key: pdfAppApiKey,
  pdf_app_ocr_endpoint: pdfAppOcrEndpoint,
  pdf_app_job_endpoint: pdfAppJobEndpoint,
  document_template_url: documentTemplateUrl,
};

const inputSecrets = {
  processingUiToken: "processing_ui_token",
  zapierWebhookToken: "zapier_webhook_token",
  adminSessionSecret: "admin_session_secret",
  pdfAppApiKey: "pdf_app_api_key",
  pdfAppOcrEndpoint: "pdf_app_ocr_endpoint",
  pdfAppJobEndpoint: "pdf_app_job_endpoint",
  documentTemplateUrl: "document_template_url",
};

let selectedId = null;
let isLoadingEvent = false;
let accessToken = localStorage.getItem("astebook_ui_token") || "";
let revealedSettings = null;
let allEvents = [];
let activeFilters = {
  query: "",
  status: "",
  procedure: "",
  proponente: "",
  azienda: "",
  email: "",
  dateFrom: "",
  dateTo: "",
  hasError: "",
  hasFiles: "",
};

function collapsedPanelSet() {
  try {
    return new Set(JSON.parse(localStorage.getItem(panelStorageKey) || "[]"));
  } catch {
    return new Set();
  }
}

function saveCollapsedPanels(values) {
  localStorage.setItem(panelStorageKey, JSON.stringify(Array.from(values)));
}

function panelKey(panel) {
  return panel.querySelector(".panel-toggle")?.textContent.replace(/\s+/g, " ").trim() || "";
}

function setPanelCollapsed(panel, collapsed, persist = true) {
  const toggle = panel.querySelector(".panel-toggle");
  const chevron = panel.querySelector(".panel-chevron");
  panel.classList.toggle("collapsed", collapsed);
  toggle?.setAttribute("aria-expanded", collapsed ? "false" : "true");
  if (chevron) chevron.textContent = collapsed ? "expand_more" : "expand_less";

  if (!persist) return;
  const values = collapsedPanelSet();
  const key = panelKey(panel);
  if (collapsed) values.add(key);
  else values.delete(key);
  saveCollapsedPanels(values);
}

function initCollapsiblePanels() {
  const collapsed = collapsedPanelSet();
  document.querySelectorAll(".collapsible-panel").forEach((panel) => {
    setPanelCollapsed(panel, collapsed.has(panelKey(panel)), false);
    panel.querySelector(".panel-toggle")?.addEventListener("click", () => {
      setPanelCollapsed(panel, !panel.classList.contains("collapsed"));
    });
  });
}

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

function normalizeSearch(value) {
  return String(value || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
}

function includesText(value, query) {
  return !query || normalizeSearch(value).includes(normalizeSearch(query));
}

function eventSearchText(event) {
  return [
    titleFor(event),
    event.status,
    event.source,
    event.search?.subject,
    event.search?.from,
    event.search?.codice_pratica,
    event.search?.procedura,
    event.search?.proponente,
    event.search?.azienda,
  ]
    .filter(Boolean)
    .join(" ");
}

function isSameOrAfterDate(value, date) {
  if (!date) return true;
  if (!value) return false;
  return new Date(value) >= new Date(`${date}T00:00:00`);
}

function isSameOrBeforeDate(value, date) {
  if (!date) return true;
  if (!value) return false;
  return new Date(value) <= new Date(`${date}T23:59:59`);
}

function matchesBooleanFilter(value, filterValue) {
  if (!filterValue) return true;
  return filterValue === "yes" ? Boolean(value) : !value;
}

function eventMatchesFilters(event) {
  return (
    includesText(eventSearchText(event), activeFilters.query) &&
    (!activeFilters.status || event.status === activeFilters.status) &&
    includesText(`${event.search?.procedura || ""} ${event.search?.codice_pratica || ""}`, activeFilters.procedure) &&
    includesText(event.search?.proponente, activeFilters.proponente) &&
    includesText(event.search?.azienda, activeFilters.azienda) &&
    includesText(`${event.search?.from || ""} ${event.search?.subject || ""}`, activeFilters.email) &&
    isSameOrAfterDate(event.received_at, activeFilters.dateFrom) &&
    isSameOrBeforeDate(event.received_at, activeFilters.dateTo) &&
    matchesBooleanFilter(event.has_error, activeFilters.hasError) &&
    matchesBooleanFilter(event.file_count > 0, activeFilters.hasFiles)
  );
}

function activeFilterCount() {
  return Object.entries(activeFilters).filter(([key, value]) => key !== "query" && value).length;
}

function syncFilterButtonState() {
  const count = activeFilterCount();
  filtersButton.classList.toggle("active", count > 0);
  filtersButton.title = count > 0 ? `Filtri attivi: ${count}` : "Filtri";
}

function eventsWithWorkflowIssues() {
  return allEvents.filter((event) => event.workflow_issue);
}

function renderNotifications() {
  const events = eventsWithWorkflowIssues();
  notificationsCount.hidden = events.length === 0;
  notificationsCount.textContent = events.length > 99 ? "99+" : String(events.length);
  notificationsButton.classList.toggle("active", events.length > 0);
  notificationsButton.title = events.length > 0 ? `${events.length} lavorazioni bloccate` : "Nessuna lavorazione bloccata";

  notificationsPane.innerHTML = "";
  if (!events.length) {
    const empty = document.createElement("p");
    empty.className = "empty-state notification-empty";
    empty.textContent = "Nessuna lavorazione bloccata.";
    notificationsPane.append(empty);
    return;
  }

  events.forEach((event) => {
    const item = document.createElement("button");
    item.type = "button";
    item.className = "notification-item";

    const header = document.createElement("div");
    header.className = "notification-item-header";
    const title = document.createElement("strong");
    title.textContent = titleFor(event);
    const count = document.createElement("span");
    count.textContent = event.workflow_issue.step;
    header.append(title, count);

    const list = document.createElement("ul");
    [event.workflow_issue.message, ...(event.workflow_issue.details || [])].filter(Boolean).slice(0, 6).forEach((message) => {
      const row = document.createElement("li");
      row.textContent = message;
      list.append(row);
    });

    item.append(header, list);
    item.addEventListener("click", async () => {
      notificationsModal.hidden = true;
      await loadEvent(event.id);
    });
    notificationsPane.append(item);
  });
}

function readFiltersFromForm() {
  activeFilters = {
    ...activeFilters,
    status: filterStatus.value,
    procedure: filterProcedure.value.trim(),
    proponente: filterProponente.value.trim(),
    azienda: filterAzienda.value.trim(),
    email: filterEmail.value.trim(),
    dateFrom: filterDateFrom.value,
    dateTo: filterDateTo.value,
    hasError: filterHasError.value,
    hasFiles: filterHasFiles.value,
  };
}

function resetFilters() {
  filtersForm.reset();
  activeFilters = {
    query: eventSearchInput.value.trim(),
    status: "",
    procedure: "",
    proponente: "",
    azienda: "",
    email: "",
    dateFrom: "",
    dateTo: "",
    hasError: "",
    hasFiles: "",
  };
  renderEventList();
}

function hasExtractedData(event) {
  return Boolean(event.result?.extracted?.annuncio || event.result?.extracted?.proposta);
}

function workflowStateLabel(state) {
  return (
    {
      done: "Completato",
      failed: "Errore",
      blocked: "Bloccato",
      pending: "In attesa",
    }[state] || state
  );
}

const workflowSteps = [
  {
    key: "mail",
    label: "Mail",
    icon: "mail",
    done: (event) => Boolean(event.received_at || event.steps?.some((step) => /request received/i.test(step.message))),
    failed: () => false,
  },
  {
    key: "ocr",
    label: "OCR",
    icon: "document_scanner",
    done: (event) => event.steps?.some((step) => /ocr completed/i.test(step.message)) || hasExtractedData(event),
    failed: (event) => event.steps?.some((step) => step.level === "error" && /ocr/i.test(step.message)),
  },
  {
    key: "extraction",
    label: "AI",
    icon: "fact_check",
    done: hasExtractedData,
    failed: (event) =>
      event.steps?.some((step) => step.level === "error" && /extraction|estrazione/i.test(step.message)) ||
      event.status === "failed",
  },
  {
    key: "complete",
    label: "Completo",
    icon: "task_alt",
    done: (event) => event.status === "completed" || Boolean(event.result?.ready_for_zapier),
    failed: (event) => event.status === "failed",
  },
];

function renderWorkflowStatus(event) {
  selectedStatus.innerHTML = "";
  selectedStatus.className = "workflow-status";
  selectedStatus.setAttribute("aria-label", `Stato lavorazione: ${event.status}`);

  let blocked = false;
  workflowSteps.forEach((step, index) => {
    const failed = !blocked && step.failed(event);
    const done = !blocked && !failed && step.done(event);
    const state = failed ? "failed" : blocked ? "blocked" : done ? "done" : "pending";
    if (failed) blocked = true;

    const item = document.createElement("div");
    item.className = `workflow-step ${state}`;
    item.title = `${step.label}: ${workflowStateLabel(state)}`;

    const circle = document.createElement("span");
    circle.className = "workflow-circle";
    const icon = document.createElement("span");
    icon.className = "material-symbols-outlined";
    icon.setAttribute("aria-hidden", "true");
    icon.textContent =
      state === "done" ? "check" : state === "failed" ? "close" : state === "blocked" ? "lock" : step.icon;
    circle.append(icon);

    const label = document.createElement("span");
    label.className = "workflow-label";
    label.textContent = step.label;

    item.append(circle, label);
    selectedStatus.append(item);

    if (index < workflowSteps.length - 1) {
      const connector = document.createElement("span");
      connector.className = `workflow-connector ${state === "done" ? "done" : failed ? "failed" : ""}`;
      selectedStatus.append(connector);
    }
  });
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

function fileNameFromStep(step) {
  return step?.data?.file_name || step?.data?.file_pdf || step?.data?.file || null;
}

function isFileStep(step) {
  return Boolean(fileNameFromStep(step));
}

function pipelineSteps(event) {
  return (event.steps || []).filter((step) => !isFileStep(step));
}

function fileStepGroups(event) {
  const groups = new Map();
  (event.result?.attachments || event.request?.files || []).forEach((file) => {
    const fileName = file.file_name || file.originalname || file.name || file.field_name || "File";
    if (!groups.has(fileName)) groups.set(fileName, { file, steps: [] });
  });

  (event.steps || []).filter(isFileStep).forEach((step) => {
    const fileName = fileNameFromStep(step);
    if (!groups.has(fileName)) groups.set(fileName, { file: { file_name: fileName }, steps: [] });
    groups.get(fileName).steps.push(step);
  });

  return Array.from(groups.entries()).map(([fileName, group]) => ({ fileName, ...group }));
}

function renderStepItem(step) {
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

  return item;
}

function renderPipelineSteps(event) {
  stepsPane.innerHTML = "";
  const steps = pipelineSteps(event);
  if (!steps.length) {
    const empty = document.createElement("p");
    empty.className = "empty-state";
    empty.textContent = "Nessuno step generale registrato.";
    stepsPane.append(empty);
    return;
  }

  steps.forEach((step) => stepsPane.append(renderStepItem(step)));
}

function renderFileSections(event) {
  filesPane.innerHTML = "";
  const groups = fileStepGroups(event);
  if (!groups.length) {
    const empty = document.createElement("p");
    empty.className = "empty-state";
    empty.textContent = "Nessun file ricevuto.";
    filesPane.append(empty);
    return;
  }

  groups.forEach(({ fileName, file, steps }) => {
    const details = document.createElement("details");
    details.className = "data-section file-section";
    details.open = steps.some((step) => step.level === "error");

    const summary = document.createElement("summary");
    const title = document.createElement("span");
    title.textContent = fileName;
    const meta = document.createElement("small");
    meta.textContent = `${file.format || file.mime_type || file.mimetype || "-"} · ${steps.length} log`;
    summary.append(title, meta);
    details.append(summary);

    const descriptor = {
      field_name: file.field_name || file.fieldname || null,
      mime_type: file.mime_type || file.mimetype || null,
      format: file.format || null,
      kind: file.kind || null,
      supported_by_extraction: file.supported_by_extraction,
      size: file.size || null,
    };
    const descriptorContainer = document.createElement("div");
    descriptorContainer.className = "file-descriptor";
    renderStructured(descriptorContainer, descriptor, "Nessun dettaglio file.");
    details.append(descriptorContainer);

    if (steps.length) {
      const stepList = document.createElement("div");
      stepList.className = "file-steps";
      steps.forEach((step) => stepList.append(renderStepItem(step)));
      details.append(stepList);
    }

    filesPane.append(details);
  });
}

function renderNotes(event) {
  renderStructured(notesPane, event.result?.notes || [], "Nessuna nota.");
}

function renderMissingFields(event) {
  renderStructured(
    missingFieldsPane,
    event.result?.missing_fields || event.error?.missing_fields || [],
    "Nessun campo mancante."
  );
}

function pipelineErrors(event) {
  const stepErrors = (event.steps || [])
    .filter((step) => step.level === "error")
    .map((step) => ({
      step: step.message,
      at: step.at,
      file: fileNameFromStep(step),
      detail: step.data?.error || step.data?.reason || null,
    }));
  const genericError = event.error?.message
    ? [{ step: "Errore evento", detail: event.error.message }]
    : [];
  return [...stepErrors, ...genericError];
}

function extractedResultView(event) {
  const result = { ...(event.result || {}) };
  delete result.notes;
  delete result.missing_fields;
  return result;
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
    ["PDF-app API Key", settings.pdf_app_api_key || "-"],
    ["PDF-app OCR Endpoint", settings.pdf_app_ocr_endpoint || "-"],
    ["PDF-app Job Endpoint", settings.pdf_app_job_endpoint || "-"],
    ["Template Documento", settings.document_template_url || "-"],
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
  allEvents = data.events || [];
  renderNotifications();
  renderEventList();

  if (!selectedId && allEvents[0] && !isLoadingEvent) {
    await loadEvent(allEvents[0].id);
  }
}

function renderEventList() {
  eventList.innerHTML = "";
  const events = allEvents.filter(eventMatchesFilters);

  if (!events.length) {
    const empty = document.createElement("div");
    empty.className = "event-empty";
    empty.textContent = "Nessuna lavorazione trovata.";
    eventList.append(empty);
    syncFilterButtonState();
    return;
  }

  events.forEach((event) => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = `event-item${event.id === selectedId ? " active" : ""}`;

    const title = document.createElement("strong");
    title.textContent = titleFor(event);
    const meta = document.createElement("span");
    meta.textContent = `${event.status} - ${formatDate(event.received_at)}`;
    button.append(title, meta);

    if (event.error_count > 0) {
      const badge = document.createElement("span");
      badge.className = "event-error-badge";
      badge.textContent = event.error_count > 99 ? "99+" : String(event.error_count);
      badge.title = `${event.error_count} errori presenti`;
      button.append(badge);
    }

    button.addEventListener("click", () => loadEvent(event.id));
    eventList.appendChild(button);
  });
  syncFilterButtonState();
}

async function loadEvent(id) {
  isLoadingEvent = true;
  selectedId = id;
  documentButton.disabled = false;
  reprocessButton.disabled = false;
  const response = await apiFetch(`/api/v1/processing-events/${id}`);
  const data = await response.json();
  const event = data.event;

  selectedSource.textContent = event.source;
  selectedTitle.textContent = titleFor(event);
  renderWorkflowStatus(event);
  receivedAt.textContent = formatDate(event.received_at);
  updatedAt.textContent = formatDate(event.updated_at);
  fileCount.textContent = event.request?.files?.length || 0;
  renderStructured(requestPane, event.request, "Nessun payload ricevuto.");
  renderStructured(resultPane, extractedResultView(event), "Nessun dato estratto.");
  renderPipelineSteps(event);
  renderFileSections(event);
  renderNotes(event);
  renderMissingFields(event);
  renderStructured(errorPane, pipelineErrors(event), "Nessun errore pipeline.");

  isLoadingEvent = false;
  await loadEvents();
}

refreshButton.addEventListener("click", loadEvents);
eventSearchInput.addEventListener("input", () => {
  activeFilters.query = eventSearchInput.value.trim();
  renderEventList();
});
filtersButton.addEventListener("click", () => {
  filtersModal.hidden = false;
});
closeFiltersButton.addEventListener("click", () => {
  filtersModal.hidden = true;
});
filtersModal.addEventListener("click", (event) => {
  if (event.target === filtersModal) filtersModal.hidden = true;
});
filtersForm.addEventListener("submit", (event) => {
  event.preventDefault();
  readFiltersFromForm();
  filtersModal.hidden = true;
  renderEventList();
});
resetFiltersButton.addEventListener("click", resetFilters);
documentButton.addEventListener("click", () => {
  if (!selectedId) return;
  window.open(`/api/v1/processing-events/${selectedId}/document?format=pdf`, "_blank", "noopener");
});
reprocessButton.addEventListener("click", async () => {
  if (!selectedId) return;
  reprocessButton.disabled = true;
  reprocessButton.querySelector(".material-symbols-outlined").textContent = "hourglass_top";
  const response = await apiFetch(`/api/v1/processing-events/${selectedId}/reprocess`, {
    method: "POST",
  });
  reprocessButton.querySelector(".material-symbols-outlined").textContent = "sync";
  reprocessButton.disabled = false;
  if (response.ok) {
    await loadEvent(selectedId);
    return;
  }
  window.alert("Riprocessamento non riuscito.");
});
settingsButton.addEventListener("click", openSettings);
notificationsButton.addEventListener("click", () => {
  renderNotifications();
  notificationsModal.hidden = false;
});
closeNotificationsButton.addEventListener("click", () => {
  notificationsModal.hidden = true;
});
notificationsModal.addEventListener("click", (event) => {
  if (event.target === notificationsModal) notificationsModal.hidden = true;
});
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
    pdf_app_api_key: pdfAppApiKey.value.trim(),
    pdf_app_ocr_endpoint: pdfAppOcrEndpoint.value.trim(),
    pdf_app_job_endpoint: pdfAppJobEndpoint.value.trim(),
    document_template_url: documentTemplateUrl.value.trim(),
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
    pdfAppApiKey.value = "";
    adminPassword.value = "";
    revealedSettings = null;
    settingsStatus.textContent = "Impostazioni salvate.";
    await loadSettings();
    return;
  }

  settingsStatus.textContent = "Errore durante il salvataggio.";
});

initCollapsiblePanels();
loadEvents();
loadSettings();
