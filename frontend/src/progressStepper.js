const PROGRESS_ID = "temporaryProcessingStepper";
const POLL_MS = 1500;

let currentEventId = null;
let pollTimer = null;
let active = false;

function apiHeaders() {
  const token = localStorage.getItem("astebook_ui_token") || "";
  return token ? { "x-astebook-token": token } : {};
}

function normalize(value) {
  return String(value || "").trim().toLowerCase();
}

function escapeHtml(value) {
  return String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function fileNameFrom(raw, fallback = "Documento") {
  return String(
    raw?.file_name ||
      raw?.filename ||
      raw?.originalname ||
      raw?.name ||
      raw?.file_pdf ||
      raw?.field_name ||
      raw?.fieldname ||
      fallback
  );
}

function isImageFile(raw) {
  const name = typeof raw === "string" ? raw : fileNameFrom(raw, "");
  const mime = typeof raw === "string" ? "" : raw?.mime_type || raw?.mimetype || raw?.file_mime_type || "";
  const format = typeof raw === "string" ? "" : raw?.format || "";
  return (
    normalize(format) === "image" ||
    normalize(format) === "png" ||
    normalize(mime).startsWith("image/") ||
    /\.(png|jpe?g|gif|webp|bmp|tiff?|heic)$/i.test(String(name || ""))
  );
}

function stepFileName(step) {
  return fileNameFrom(step?.data, "");
}

function sameFile(step, docName) {
  const candidate = normalize(stepFileName(step));
  const target = normalize(docName);
  return Boolean(candidate && target && (candidate === target || candidate.includes(target) || target.includes(candidate)));
}

function documentsForEvent(event) {
  const docs = [];
  const seen = new Set();
  const add = (raw, fallback) => {
    if (isImageFile(raw)) return;
    const name = fileNameFrom(raw, fallback);
    const key = normalize(name);
    if (!key || seen.has(key)) return;
    seen.add(key);
    docs.push({ name, raw });
  };

  (event?.result?.attachments || []).forEach((item, index) => add(item, `Documento ${index + 1}`));
  (event?.request?.files || []).forEach((item, index) => add(item, `Documento ${index + 1}`));

  if (!docs.length && event?.request?.body) {
    const hasBody = Object.values(event.request.body).some((value) => typeof value === "string" && value.trim());
    if (hasBody) docs.push({ name: "Corpo email", raw: event.request.body });
  }

  return docs;
}

function latestStep(steps, predicate) {
  return [...steps].reverse().find(predicate);
}

function ocrStatusFor(doc, steps, isCurrent) {
  const completed = latestStep(steps, (step) => /PDF-app OCR completed/i.test(step.message || "") && sameFile(step, doc.name));
  if (completed) {
    const length = completed.data?.text_length ? `${completed.data.text_length} caratteri` : "OCR completato";
    return { state: "done", title: "Analyze success", detail: length };
  }

  const failed = latestStep(steps, (step) => /PDF-app OCR failed/i.test(step.message || "") && sameFile(step, doc.name));
  if (failed) return { state: "error", title: "Analyze failed", detail: failed.data?.error || "OCR fallito" };

  const skipped = latestStep(steps, (step) => /PDF-app OCR skipped|PDF-app OCR skipped or empty/i.test(step.message || "") && sameFile(step, doc.name));
  if (skipped) return { state: "done", title: "Analyze success", detail: skipped.data?.reason || "OCR non necessario o vuoto" };

  return isCurrent ? { state: "running", title: "Analyzing...", detail: "OCR in corso" } : { state: "pending", title: "Pending", detail: "In attesa OCR" };
}

function aiStatusFor(doc, steps, isCurrent) {
  const success = latestStep(
    steps,
    (step) =>
      /extracted|AI extraction completed/i.test(step.message || "") &&
      (sameFile(step, doc.name) || normalize(doc.name) === "corpo email")
  );
  if (success) return { state: "done", title: "Analyze success", detail: success.message || "AI completata" };

  const failed = latestStep(steps, (step) => /AI extraction failed|extraction failed/i.test(step.message || "") && sameFile(step, doc.name));
  if (failed) return { state: "error", title: "Analyze failed", detail: failed.data?.error || "AI fallita" };

  return isCurrent ? { state: "running", title: "Analyzing...", detail: "AI in analisi" } : { state: "pending", title: "Pending", detail: "In attesa AI" };
}

function mailingStatusFor(event) {
  const status = event?.result?.document_email?.status || "";
  const steps = event?.steps || [];
  if (status === "sent" || steps.some((step) => /Automatic document email sent|Document email sent/i.test(step.message || ""))) {
    return { state: "done", title: "Email inviata", detail: "PDF e report spediti" };
  }
  if (["failed", "skipped"].includes(status)) {
    return {
      state: "error",
      title: status === "skipped" ? "Invio non eseguito" : "Invio fallito",
      detail: event?.result?.document_email?.reason || event?.result?.document_email?.error || "Controlla impostazioni email",
    };
  }
  if (steps.some((step) => /Automatic document email failed|Document email failed/i.test(step.message || ""))) {
    const failed = latestStep(steps, (step) => /Automatic document email failed|Document email failed/i.test(step.message || ""));
    return { state: "error", title: "Invio fallito", detail: failed?.data?.error || "Controlla log mailing" };
  }
  if (event?.result?.merged) return { state: "running", title: "Invio in corso", detail: "PDF e report email" };
  return { state: "pending", title: "Pending", detail: "In attesa merged" };
}

function hasPipelineFinished(event) {
  if (event?.status === "failed") return true;
  return ["done", "error"].includes(mailingStatusFor(event).state);
}

function ensureStyles() {
  if (document.getElementById("temporaryProcessingStepperStyles")) return;
  const style = document.createElement("style");
  style.id = "temporaryProcessingStepperStyles";
  style.textContent = `
    .temporary-processing {
      display: grid;
      gap: 12px;
      padding: 16px 20px;
      border-bottom: 1px solid var(--line, #d8dee8);
      background: #fff;
    }
    .temporary-processing[hidden] { display: none; }
    .temporary-processing-title {
      display: flex;
      align-items: center;
      gap: 8px;
      font-weight: 900;
      color: var(--accent, #146c94);
    }
    .temporary-processing-grid {
      display: grid;
      grid-template-columns: repeat(2, minmax(0, 1fr));
      gap: 12px;
    }
    @media (max-width: 900px) {
      .temporary-processing-grid { grid-template-columns: 1fr; }
    }
  `;
  document.head.append(style);
}

function ensureHost() {
  ensureStyles();
  let host = document.getElementById(PROGRESS_ID);
  if (host) return host;

  host = document.createElement("section");
  host.id = PROGRESS_ID;
  host.className = "temporary-processing";
  host.hidden = true;

  const summary = document.querySelector(".summary-grid");
  if (summary) summary.insertAdjacentElement("afterend", host);
  return host;
}

function renderCircularGroup({ title, icon, docs, statusFor }) {
  const steps = docs
    .map((doc, index) => {
      const status = statusFor(doc, index);
      const state = status.state === "error" ? "failed" : status.state;
      const symbol = state === "done" ? "check" : state === "failed" ? "close" : "hourglass_top";
      return `
        <div class="analysis-substep ${state}" title="${escapeHtml(doc.name)} - ${escapeHtml(status.title)}${status.detail ? ` - ${escapeHtml(status.detail)}` : ""}">
          <span class="analysis-substep-circle">
            <span class="material-symbols-outlined" aria-hidden="true">${symbol}</span>
          </span>
          <span class="analysis-substep-label">${escapeHtml(doc.name)}</span>
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

function renderProgress(event) {
  const host = ensureHost();
  const docs = documentsForEvent(event);
  if (!active || !docs.length || hasPipelineFinished(event)) {
    host.hidden = true;
    host.innerHTML = "";
    return;
  }

  const steps = event?.steps || [];
  const currentOcrIndex = docs.findIndex((doc) => !["done", "error"].includes(ocrStatusFor(doc, steps, false).state));
  const aiStarted = steps.some((step) => /AI extraction started|Announcement AI|Proposal|Commission|Codice pratica|extracted/i.test(step.message || ""));
  const currentAiIndex = docs.findIndex((doc) => !["done", "error"].includes(aiStatusFor(doc, steps, false).state));

  host.hidden = false;
  host.innerHTML = `
    <div class="temporary-processing-title">
      <span class="material-symbols-outlined" aria-hidden="true">sync</span>
      <span>Lavorazione in corso: OCR e analisi AI</span>
    </div>
    <div class="temporary-processing-grid">
      ${renderCircularGroup({
        title: "OCR",
        icon: "document_scanner",
        docs,
        statusFor: (doc, index) => ocrStatusFor(doc, steps, index === currentOcrIndex),
      })}
      ${renderCircularGroup({
        title: "AI Extraction",
        icon: "psychology",
        docs,
        statusFor: (doc, index) => aiStatusFor(doc, steps, aiStarted && index === currentAiIndex),
      })}
    </div>`;
}

async function fetchEvent(id) {
  const resp = await fetch(`/api/v1/processing-events/${id}`, {
    headers: apiHeaders(),
    credentials: "same-origin",
  });
  if (!resp.ok) return null;
  const data = await resp.json();
  return data.event || null;
}

function startPolling(id) {
  stopPolling();
  pollTimer = window.setInterval(async () => {
    const event = await fetchEvent(id).catch(() => null);
    if (!event) return;
    renderProgress(event);
    if (hasPipelineFinished(event)) stopPolling();
  }, POLL_MS);
}

function stopPolling() {
  if (pollTimer) window.clearInterval(pollTimer);
  pollTimer = null;
}

function selectedEventIdFromDom() {
  const activeItem = document.querySelector(".event-item.active[data-event-id]");
  if (activeItem?.dataset.eventId) return activeItem.dataset.eventId;
  const firstItem = document.querySelector(".event-item[data-event-id]");
  return firstItem?.dataset.eventId || currentEventId;
}

function initProgressStepper() {
  ensureHost();

  document.addEventListener("click", async (event) => {
    const eventButton = event.target.closest?.(".event-item[data-event-id]");
    if (eventButton) currentEventId = eventButton.dataset.eventId;

    const reprocessButton = event.target.closest?.("#reprocessButton");
    if (!reprocessButton) return;

    const id = selectedEventIdFromDom();
    if (!id) return;
    currentEventId = id;
    active = true;

    const currentEvent = await fetchEvent(id).catch(() => null);
    if (currentEvent) renderProgress({ ...currentEvent, status: "extracting" });
    startPolling(id);
  }, true);

  const originalFetch = window.fetch.bind(window);
  window.fetch = async (...args) => {
    const response = await originalFetch(...args);
    const url = String(args[0]?.url || args[0] || "");
    if (/\/api\/v1\/processing-events\/[^/]+\/reprocess/.test(url)) {
      response.clone().json().catch(() => null).then((data) => {
        active = false;
        stopPolling();
        if (data?.event) renderProgress(data.event);
      });
    }
    return response;
  };
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", initProgressStepper);
} else {
  initProgressStepper();
}
