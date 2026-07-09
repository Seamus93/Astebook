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
      grid-template-columns: repeat(3, minmax(0, 1fr));
      gap: 12px;
    }
    .substepper-group {
      border: 1px solid var(--line, #d8dee8);
      border-radius: 8px;
      background: var(--panel-soft, #f9fafc);
      overflow: hidden;
    }
    .substepper-header {
      display: flex;
      align-items: center;
      gap: 8px;
      padding: 10px 12px;
      border-bottom: 1px solid var(--line, #d8dee8);
      font-weight: 900;
      background: #fff;
    }
    .substepper-list { display: grid; }
    .substepper-row {
      display: grid;
      grid-template-columns: 16px minmax(0, 1fr);
      gap: 10px;
      padding: 10px 12px;
      border-bottom: 1px solid rgba(216, 222, 232, .75);
    }
    .substepper-row:last-child { border-bottom: 0; }
    .substepper-dot {
      width: 11px;
      height: 11px;
      margin-top: 4px;
      border-radius: 999px;
      border: 2px solid #bcc7d6;
      background: #fff;
    }
    .substepper-row.running .substepper-dot {
      border-color: #d8a441;
      background: #fff4d6;
      animation: astebookPulse 1s ease-in-out infinite;
    }
    .substepper-row.done .substepper-dot {
      border-color: #1f8a5b;
      background: #1f8a5b;
    }
    .substepper-row.error .substepper-dot {
      border-color: #b42318;
      background: #b42318;
    }
    .substepper-main strong,
    .substepper-main span {
      display: block;
      overflow-wrap: anywhere;
    }
    .substepper-main span {
      margin-top: 3px;
      color: var(--muted, #657287);
      font-size: 12px;
    }
    .substepper-row.running .substepper-main span { color: #9a6700; }
    .substepper-row.done .substepper-main span { color: #1f8a5b; }
    .substepper-row.error .substepper-main span { color: #b42318; }
    @keyframes astebookPulse {
      0%, 100% { transform: scale(1); opacity: 1; }
      50% { transform: scale(1.35); opacity: .55; }
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

function renderGroup({ title, icon, docs, statusFor }) {
  const rows = docs
    .map((doc, index) => {
      const status = statusFor(doc, index);
      return `
        <div class="substepper-row ${status.state}">
          <span class="substepper-dot"></span>
          <div class="substepper-main">
            <strong>${escapeHtml(doc.name)}</strong>
            <span>${escapeHtml(status.title)}${status.detail ? ` · ${escapeHtml(status.detail)}` : ""}</span>
          </div>
        </div>`;
    })
    .join("");

  return `
    <article class="substepper-group">
      <div class="substepper-header">
        <span class="material-symbols-outlined" aria-hidden="true">${icon}</span>
        <strong>${escapeHtml(title)}</strong>
      </div>
      <div class="substepper-list">${rows}</div>
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
      ${renderGroup({
        title: "OCR documenti",
        icon: "document_scanner",
        docs,
        statusFor: (doc, index) => ocrStatusFor(doc, steps, index === currentOcrIndex),
      })}
      ${renderGroup({
        title: "Analisi AI",
        icon: "psychology",
        docs,
        statusFor: (doc, index) => aiStatusFor(doc, steps, aiStarted && index === currentAiIndex),
      })}
      ${renderGroup({
        title: "Mailing",
        icon: "outgoing_mail",
        docs: [{ name: "PDF + Report", raw: {} }],
        statusFor: () => mailingStatusFor(event),
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
