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

function showToast({ title = "", message = "", items = [], tone = "error" } = {}) {
  let host = document.getElementById("toastHost");
  if (!host) {
    host = document.createElement("div");
    host.id = "toastHost";
    host.className = "toast-host";
    document.body.appendChild(host);
  }

  const toast = document.createElement("div");
  toast.className = `toast ${tone}`;
  const itemList = items.length
    ? `<ul>${items.map((item) => `<li>${escapeHtml(item)}</li>`).join("")}</ul>`
    : "";
  toast.innerHTML = `
    <div class="toast-icon"><span class="material-symbols-outlined" aria-hidden="true">${tone === "error" ? "error" : "info"}</span></div>
    <div class="toast-body">
      ${title ? `<strong>${escapeHtml(title)}</strong>` : ""}
      ${message ? `<p>${escapeHtml(message)}</p>` : ""}
      ${itemList}
    </div>
    <button class="icon-button toast-close" type="button" title="Chiudi">
      <span class="material-symbols-outlined" aria-hidden="true">close</span>
    </button>`;
  host.appendChild(toast);

  const close = () => toast.remove();
  toast.querySelector(".toast-close")?.addEventListener("click", close);
  window.setTimeout(close, 9000);
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
        document_send_to: 'documentSendTo',
        smtp_host: 'smtpHost',
        smtp_port: 'smtpPort',
        smtp_secure: 'smtpSecure',
        smtp_user: 'smtpUser',
        smtp_password: 'smtpPassword',
        smtp_from: 'smtpFrom',
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

function escapeHtml(value) {
  return String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function jsonSyntaxHighlight(value) {
  const json = JSON.stringify(value, null, 2);
  return escapeHtml(json)
    .replace(/("(\\u[a-zA-Z0-9]{4}|\\[^u]|[^\\"])*"\s*?:)/g, '<span class="json-key">$1</span>')
    .replace(/("(\\u[a-zA-Z0-9]{4}|\\[^u]|[^\\"])*")/g, '<span class="json-string">$1</span>')
    .replace(/\b(true|false|null)\b/g, '<span class="json-literal">$1</span>')
    .replace(/\b(-?\d+(?:\.\d+)?(?:[eE][+\-]?\d+)?)\b/g, '<span class="json-number">$1</span>');
}

function renderJsonPane(id, value) {
  const el = document.getElementById(id);
  if (!el) return;
  const isEmptyObject = value && typeof value === 'object' && !Array.isArray(value) && Object.keys(value).length === 0;
  const isEmptyArray = Array.isArray(value) && value.length === 0;
  if (value === null || value === undefined || isEmptyObject || isEmptyArray) {
    el.innerHTML = '<div class="empty-state">Nessun dato disponibile</div>';
    return;
  }
  el.innerHTML = `<code class="json-code">${jsonSyntaxHighlight(value)}</code>`;
}

function isPlainObject(value) {
  return value && typeof value === 'object' && !Array.isArray(value);
}

function primitiveText(value) {
  if (value === null || value === undefined || value === "") return "-";
  if (typeof value === "boolean") return value ? "Si" : "No";
  return String(value);
}

function labelFor(key) {
  const labels = {
    body: "Corpo email",
    request: "Richiesta",
    files: "File",
    extracted: "Estratto",
    missing_fields: "Campi mancanti",
    error: "Errore",
    notes: "Note",
    file_name: "Nome file",
    originalname: "Nome originale",
    fieldname: "Field",
    mimetype: "Mime type",
    size: "Dimensione",
    url: "URL",
    subject: "Oggetto",
    from: "Mittente",
    codice_pratica: "Codice pratica",
    zap_run_id: "Zap Run ID",
    email_id: "Email ID",
    status: "Stato",
    source: "Origine",
    received_at: "Ricevuto il",
    updated_at: "Aggiornato il",
    has_body_text: "Testo email disponibile",
    note: "Nota",
  };
  return labels[key] || key.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

function appendValue(container, key, value) {
  if (Array.isArray(value)) {
    const details = document.createElement("details");
    details.className = "data-section";
    details.open = value.length <= 3;

    const summary = document.createElement("summary");
    summary.textContent = `${labelFor(key)} (${value.length})`;
    details.appendChild(summary);

    if (value.length === 0) {
      const empty = document.createElement("p");
      empty.className = "empty-state";
      empty.textContent = "Nessun valore.";
      details.appendChild(empty);
    } else {
      value.forEach((item, index) => appendValue(details, `${key} ${index + 1}`, item));
    }

    container.appendChild(details);
    return;
  }

  if (isPlainObject(value)) {
    const details = document.createElement("details");
    details.className = "data-section";
    details.open = true;

    const summary = document.createElement("summary");
    summary.textContent = labelFor(key);
    details.appendChild(summary);

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
      list.appendChild(row);
    });

    details.appendChild(list);
    container.appendChild(details);
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
  container.appendChild(row);
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
    container.appendChild(empty);
    return;
  }

  if (isPlainObject(value)) {
    Object.entries(value).forEach(([key, childValue]) => appendValue(container, key, childValue));
    return;
  }

  appendValue(container, "Valore", value);
}

function hasExtractedData(event) {
  return Boolean(event.result?.extracted?.annuncio || event.result?.extracted?.proposta);
}

function mailingStatus(event) {
  const documentEmail = event.result?.document_email || {};
  const message = documentEmail.status || "";
  const steps = event.steps || [];
  if (message === "sent" || steps.some((step) => /Automatic document email sent|Document email sent/i.test(step.message || ""))) {
    return "done";
  }
  if (
    ["failed", "skipped"].includes(message) ||
    steps.some((step) => /Automatic document email failed|Document email failed/i.test(step.message || ""))
  ) {
    return "failed";
  }
  if (event.result?.merged) return "pending";
  return "blocked";
}

function workflowStateLabel(state) {
  return {
    done: "Completato",
    failed: "Errore",
    blocked: "Bloccato",
    pending: "In attesa",
  }[state] || state;
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
    key: "scraper",
    label: "Scraper",
    icon: "fact_check",
    done: hasExtractedData,
    failed: (event) =>
      event.steps?.some((step) => step.level === "error" && /scraper|extraction|estrazione/i.test(step.message)) ||
      event.status === "failed",
  },
  {
    key: "mailing",
    label: "Mailing",
    icon: "outgoing_mail",
    done: (event) => mailingStatus(event) === "done",
    failed: (event) => mailingStatus(event) === "failed",
  },
  {
    key: "complete",
    label: "Completo",
    icon: "task_alt",
    done: (event) =>
      (event.status === "completed" || Boolean(event.result?.ready_for_zapier)) &&
      mailingStatus(event) === "done",
    failed: (event) => event.status === "failed",
  },
];

function renderWorkflowStatus(event) {
  const selectedStatus = document.getElementById("selectedStatus");
  if (!selectedStatus) return;
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
    icon.textContent = state === "done" ? "check" : state === "failed" ? "close" : state === "blocked" ? "lock" : step.icon;
    circle.appendChild(icon);

    const label = document.createElement("span");
    label.className = "workflow-label";
    label.textContent = step.label;

    item.append(circle, label);
    selectedStatus.appendChild(item);

    if (index < workflowSteps.length - 1) {
      const connector = document.createElement("span");
      connector.className = `workflow-connector ${state === "done" ? "done" : failed ? "failed" : ""}`;
      selectedStatus.appendChild(connector);
    }
  });
}

function fileNameFromStep(step) {
  return step?.data?.file_name || step?.data?.file_pdf || step?.data?.file || null;
}

function isFileStep(step) {
  return Boolean(fileNameFromStep(step));
}

function fileDisplayName(file, fallback = "File") {
  return file?.file_name || file?.originalname || file?.filename || file?.name || file?.field_name || file?.fieldname || fallback;
}

function normalizeFileText(value) {
  return String(value || "").trim().toLowerCase();
}

function isImageFile(fileOrName) {
  const name =
    typeof fileOrName === "string"
      ? fileOrName
      : fileDisplayName(fileOrName, "");
  const mime =
    typeof fileOrName === "string"
      ? ""
      : fileOrName?.mime_type || fileOrName?.mimetype || fileOrName?.file_mime_type || "";
  const format = typeof fileOrName === "string" ? "" : fileOrName?.format || "";
  return (
    normalizeFileText(format) === "image" ||
    normalizeFileText(format) === "png" ||
    normalizeFileText(mime).startsWith("image/") ||
    /\.(png|jpe?g|gif|webp|bmp|tiff?|heic)$/i.test(String(name || ""))
  );
}

function sameAnalysisFile(step, fileName) {
  const candidate = normalizeFileText(fileNameFromStep(step));
  const target = normalizeFileText(fileName);
  return Boolean(candidate && target && (candidate === target || candidate.includes(target) || target.includes(candidate)));
}

function pipelineSteps(event) {
  return (event.steps || []).filter((step) => !isFileStep(step));
}

function fileStepGroups(event) {
  const groups = new Map();
  (event.result?.attachments || event.request?.files || []).forEach((file) => {
    if (isImageFile(file)) return;
    const fileName = fileDisplayName(file);
    if (!groups.has(fileName)) groups.set(fileName, { file, steps: [] });
  });

  (event.steps || []).filter(isFileStep).forEach((step) => {
    const fileName = fileNameFromStep(step);
    if (isImageFile(fileName)) return;
    if (!groups.has(fileName)) groups.set(fileName, { file: { file_name: fileName }, steps: [] });
    groups.get(fileName).steps.push(step);
  });

  return Array.from(groups.entries()).map(([fileName, group]) => ({ fileName, ...group }));
}

function analysisFilesForEvent(event) {
  const files = [];
  const seen = new Set();
  const add = (file, fallback) => {
    if (isImageFile(file)) return;
    const name = fileDisplayName(file, fallback);
    const key = normalizeFileText(name);
    if (!key || seen.has(key)) return;
    seen.add(key);
    files.push({ name, file });
  };

  (event.result?.attachments || []).forEach((file, index) => add(file, `File ${index + 1}`));
  (event.request?.files || []).forEach((file, index) => add(file, `File ${index + 1}`));
  (event.steps || []).filter(isFileStep).forEach((step) => add({ file_name: fileNameFromStep(step) }, "File"));

  if (!files.length && event.result?.email?.has_body_text) {
    files.push({ name: "Corpo email", file: { file_name: "Corpo email" } });
  }

  return files;
}

function statusForOcrFile(file, steps) {
  const name = file.name;
  const completed = [...steps].reverse().find((step) => /PDF-app OCR completed/i.test(step.message || "") && sameAnalysisFile(step, name));
  if (completed) return { state: "done", label: "OCR completato" };
  const failed = [...steps].reverse().find((step) => /PDF-app OCR failed/i.test(step.message || "") && sameAnalysisFile(step, name));
  if (failed) return { state: "failed", label: failed.data?.error || "OCR fallito" };
  const skipped = [...steps].reverse().find((step) => /PDF-app OCR skipped|PDF-app OCR skipped or empty/i.test(step.message || "") && sameAnalysisFile(step, name));
  if (skipped || normalizeFileText(name) === "corpo email") return { state: "done", label: "OCR non necessario" };
  if (steps.some((step) => /AI extraction started|extracted|AI extraction completed/i.test(step.message || ""))) {
    return { state: "done", label: "Testo disponibile" };
  }
  return { state: "pending", label: "In attesa OCR" };
}

function statusForAiFile(file, steps) {
  const name = file.name;
  const completed = [...steps].reverse().find(
    (step) =>
      /extracted|AI extraction completed/i.test(step.message || "") &&
      (sameAnalysisFile(step, name) || normalizeFileText(name) === "corpo email")
  );
  if (completed) return { state: "done", label: completed.message || "AI completata" };
  const failed = [...steps].reverse().find((step) => /AI extraction failed|extraction failed/i.test(step.message || "") && sameAnalysisFile(step, name));
  if (failed) return { state: "failed", label: failed.data?.error || "AI fallita" };
  if (steps.some((step) => /AI extraction started/i.test(step.message || ""))) return { state: "pending", label: "In analisi" };
  return { state: "pending", label: "In attesa AI" };
}

function renderCircularSubstepper({ title, icon, files, statusFor }) {
  const steps = files
    .map((file) => {
      const status = statusFor(file);
      return `
        <div class="analysis-substep ${status.state}" title="${escapeHtml(file.name)} - ${escapeHtml(status.label)}">
          <span class="analysis-substep-circle">
            <span class="material-symbols-outlined" aria-hidden="true">${status.state === "done" ? "check" : status.state === "failed" ? "close" : "hourglass_top"}</span>
          </span>
          <span class="analysis-substep-label">${escapeHtml(file.name)}</span>
        </div>`;
    })
    .join('<span class="analysis-substep-connector"></span>');

  return `
    <article class="analysis-substepper">
      <header>
        <span class="material-symbols-outlined" aria-hidden="true">${icon}</span>
        <strong>${escapeHtml(title)}</strong>
      </header>
      <div class="analysis-substep-list">${steps}</div>
    </article>`;
}

function renderAnalysisSubsteppers(event) {
  const host = document.getElementById("analysisSubsteppers");
  if (!host) return;
  const files = analysisFilesForEvent(event);
  if (!files.length) {
    host.hidden = true;
    host.innerHTML = "";
    return;
  }
  const steps = event.steps || [];
  host.hidden = false;
  host.innerHTML = [
    renderCircularSubstepper({
      title: "OCR",
      icon: "document_scanner",
      files,
      statusFor: (file) => statusForOcrFile(file, steps),
    }),
    renderCircularSubstepper({
      title: "AI Extraction",
      icon: "psychology",
      files,
      statusFor: (file) => statusForAiFile(file, steps),
    }),
  ].join("");
}

function renderStepItem(step) {
  const item = document.createElement("div");
  item.className = `step ${step.level === "error" ? "error" : ""}`;

  const message = document.createElement("strong");
  message.textContent = step.message;
  const date = document.createElement("span");
  date.textContent = step.at || "";
  item.append(message, date);

  if (step.data) {
    const dataContainer = document.createElement("div");
    dataContainer.className = "step-data";
    renderStructured(dataContainer, step.data, "Nessun dettaglio.");
    item.appendChild(dataContainer);
  }

  return item;
}

function renderPipelineSteps(event) {
  const stepsPane = document.getElementById("stepsPane");
  if (!stepsPane) return;
  stepsPane.innerHTML = "";
  const steps = pipelineSteps(event);
  if (!steps.length) {
    const empty = document.createElement("p");
    empty.className = "empty-state";
    empty.textContent = "Nessuno step generale registrato.";
    stepsPane.appendChild(empty);
    return;
  }
  steps.forEach((step) => stepsPane.appendChild(renderStepItem(step)));
}

function renderFileSections(event) {
  const filesPane = document.getElementById("filesPane");
  if (!filesPane) return;
  filesPane.innerHTML = "";
  const groups = fileStepGroups(event);
  if (!groups.length) {
    const empty = document.createElement("p");
    empty.className = "empty-state";
    empty.textContent = "Nessun file ricevuto.";
    filesPane.appendChild(empty);
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
    details.appendChild(summary);

    const descriptor = {
      field_name: file.field_name || file.fieldname || null,
      mime_type: file.file_mime_type || file.mimetype || file.mime_type || null,
      format: file.format || null,
      kind: file.kind || null,
      supported_by_scraper: file.supported_by_scraper,
      size: file.size || null,
    };
    const descriptorContainer = document.createElement("div");
    descriptorContainer.className = "file-descriptor";
    renderStructured(descriptorContainer, descriptor, "Nessun dettaglio file.");
    details.appendChild(descriptorContainer);

    if (steps.length) {
      const stepList = document.createElement("div");
      stepList.className = "file-steps";
      steps.forEach((step) => stepList.appendChild(renderStepItem(step)));
      details.appendChild(stepList);
    }

    filesPane.appendChild(details);
  });
}

function renderNotes(event) {
  renderStructured(document.getElementById("notesPane"), event.result?.notes || [], "Nessuna nota.");
}

function renderMissingFields(event) {
  renderStructured(
    document.getElementById("missingFieldsPane"),
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
  const genericError = event.error?.message ? [{ step: "Errore evento", detail: event.error.message }] : [];
  return [...stepErrors, ...genericError];
}

function extractedResultView(event) {
  const result = { ...(event.result || {}) };
  delete result.notes;
  delete result.missing_fields;
  return result;
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
    document.getElementById('receivedAt').textContent = ev.received_at || '-';
    document.getElementById('updatedAt').textContent = ev.updated_at || '-';
    document.getElementById('fileCount').textContent = Array.isArray(ev.request?.files) ? ev.request.files.length : '-';

    renderWorkflowStatus(ev);
    // Render request payload but hide large raw body fields; show cleaned body separately
    const requestPane = document.getElementById('requestPane');
    const emailData = ev.result?.email || {};

    const filteredRequest = structuredClone(ev.request || {});
    if (filteredRequest.body) {
    [
        'email_body_html',
        'email_body',
        'body',
        'message',
        'html',
        'raw_body',
        'plain_body',
        'body_text',
        'body_plain'
    ].forEach((k) => delete filteredRequest.body[k]);
    }

    renderStructured(requestPane, filteredRequest, 'Nessun payload ricevuto.');

    if (emailData.original_body) {
    const originalDetails = document.createElement('details');
    originalDetails.className = 'data-section';
    originalDetails.open = false;

    const originalSummary = document.createElement('summary');
    originalSummary.textContent = 'Mostra payload originale';
    originalDetails.appendChild(originalSummary);

    const originalPre = document.createElement('pre');
    originalPre.className = 'kv-value';
    originalPre.style.whiteSpace = 'pre-wrap';
    originalPre.style.maxHeight = '40vh';
    originalPre.style.overflow = 'auto';
    originalPre.textContent = emailData.original_body;

    originalDetails.appendChild(originalPre);
    requestPane.insertBefore(originalDetails, requestPane.firstChild);
    }

    if (emailData.cleaned_body) {
    const emailSection = document.createElement('details');
    emailSection.className = 'data-section';
    emailSection.open = true;

    const emailLabel = document.createElement('summary');
    emailLabel.textContent = "Body inviato all'AI";
    emailSection.appendChild(emailLabel);

    const cleanedPre = document.createElement('pre');
    cleanedPre.className = 'kv-value';
    cleanedPre.style.whiteSpace = 'pre-wrap';
    cleanedPre.style.margin = '8px 12px';
    cleanedPre.textContent = emailData.cleaned_body;

    emailSection.appendChild(cleanedPre);
    requestPane.insertBefore(emailSection, requestPane.firstChild);
    }
    renderPipelineSteps(ev);
    renderAnalysisSubsteppers(ev);
    renderFileSections(ev);
    renderStructured(document.getElementById('resultPane'), extractedResultView(ev), 'Nessun dato estratto.');
    renderNotes(ev);
    renderMissingFields(ev);
    renderStructured(document.getElementById('errorPane'), pipelineErrors(ev), 'Nessun errore pipeline.');

    const reprocessButton = document.getElementById('reprocessButton');
    const documentButton = document.getElementById('documentButton');
    const canReprocess = ev.source === 'zapier.email_activation';
    reprocessButton.disabled = !canReprocess;
    documentButton.disabled = false;
    reprocessButton.onclick = async () => {
      try {
        const res = await apiFetch(`/api/v1/processing-events/${id}/reprocess`, { method: 'POST' });
        const payload = await res.json().catch(() => ({}));
        if (!res.ok) {
          const missing = Array.isArray(payload.missing_configuration)
            ? payload.missing_configuration.map((item) => `${item.label}: ${item.detail}`)
            : [];
          showToast({
            title: payload.error || "Reprocess non avviato",
            message: missing.length
              ? "Non sono state configurate queste cose:"
              : payload.detail || `HTTP ${res.status}`,
            items: missing,
            tone: "error",
          });
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

function initSidebarToggle() {
  const shell = qs('appShell');
  const button = qs('sidebarToggleButton');
  if (!shell || !button) return;

  const applyState = (collapsed) => {
    shell.classList.toggle('sidebar-collapsed', collapsed);
    button.setAttribute('aria-expanded', String(!collapsed));
    button.title = collapsed ? 'Apri elenco lavorazioni' : 'Chiudi elenco lavorazioni';
  };

  applyState(localStorage.getItem('astebook_sidebar_collapsed') === '1');

  button.addEventListener('click', () => {
    const collapsed = !shell.classList.contains('sidebar-collapsed');
    localStorage.setItem('astebook_sidebar_collapsed', collapsed ? '1' : '0');
    applyState(collapsed);
  });
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
  initSidebarToggle();
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
