import { apiFetch } from "./apiClient.js";
import { fileNameFromStep, renderFileSections, renderPipelineSteps } from "./fileSections.js";
import { renderStructured } from "./structuredView.js";
import { showToast } from "./toast.js";
import { renderWorkflowStatus } from "./workflowView.js";

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

function renderEmailBodies(requestPane, emailData) {
  if (emailData.original_body) {
    const originalDetails = document.createElement("details");
    originalDetails.className = "data-section";
    originalDetails.open = false;

    const originalSummary = document.createElement("summary");
    originalSummary.textContent = "Mostra payload originale";
    originalDetails.appendChild(originalSummary);

    const originalPre = document.createElement("pre");
    originalPre.className = "kv-value";
    originalPre.style.whiteSpace = "pre-wrap";
    originalPre.style.maxHeight = "40vh";
    originalPre.style.overflow = "auto";
    originalPre.textContent = emailData.original_body;

    originalDetails.appendChild(originalPre);
    requestPane.insertBefore(originalDetails, requestPane.firstChild);
  }

  if (emailData.cleaned_body) {
    const emailSection = document.createElement("details");
    emailSection.className = "data-section";
    emailSection.open = true;

    const emailLabel = document.createElement("summary");
    emailLabel.textContent = "Body inviato all'AI";
    emailSection.appendChild(emailLabel);

    const cleanedPre = document.createElement("pre");
    cleanedPre.className = "kv-value";
    cleanedPre.style.whiteSpace = "pre-wrap";
    cleanedPre.style.margin = "8px 12px";
    cleanedPre.textContent = emailData.cleaned_body;

    emailSection.appendChild(cleanedPre);
    requestPane.insertBefore(emailSection, requestPane.firstChild);
  }
}

function filteredRequestPayload(event) {
  const filteredRequest = structuredClone(event.request || {});
  if (filteredRequest.body) {
    [
      "email_body_html",
      "email_body",
      "body",
      "message",
      "html",
      "raw_body",
      "plain_body",
      "body_text",
      "body_plain",
    ].forEach((key) => delete filteredRequest.body[key]);
  }
  return filteredRequest;
}

export function createDetailController() {
  let currentEvent = null;

  async function selectEvent(id) {
    try {
      const resp = await apiFetch(`/api/v1/processing-events/${id}`);
      if (!resp.ok) {
        console.warn("Failed to load event", resp.status);
        return null;
      }
      const data = await resp.json();
      const ev = data.event;
      if (!ev) return null;
      currentEvent = ev;

      document.getElementById("selectedTitle").textContent = ev.metadata?.subject || ev.id;
      document.getElementById("selectedSource").textContent = ev.source || "-";
      document.getElementById("receivedAt").textContent = ev.received_at || "-";
      document.getElementById("updatedAt").textContent = ev.updated_at || "-";
      document.getElementById("fileCount").textContent = Array.isArray(ev.request?.files) ? ev.request.files.length : "-";

      renderWorkflowStatus(ev);

      const requestPane = document.getElementById("requestPane");
      const emailData = ev.result?.email || {};
      renderStructured(requestPane, filteredRequestPayload(ev), "Nessun payload ricevuto.");
      renderEmailBodies(requestPane, emailData);

      renderPipelineSteps(ev);
      renderFileSections(ev);
      renderStructured(document.getElementById("resultPane"), extractedResultView(ev), "Nessun dato estratto.");
      renderNotes(ev);
      renderMissingFields(ev);
      renderStructured(document.getElementById("errorPane"), pipelineErrors(ev), "Nessun errore pipeline.");

      wireActionButtons(id, ev, selectEvent, () => currentEvent);
      return ev;
    } catch (err) {
      console.error("selectEvent", err);
      return null;
    }
  }

  return { selectEvent };
}

function wireActionButtons(id, ev, selectEvent, getCurrentEvent) {
  const reprocessButton = document.getElementById("reprocessButton");
  const documentButton = document.getElementById("documentButton");
  const emailDocumentButton = document.getElementById("emailDocumentButton");
  const canReprocess = ["zapier.email_activation", "imap.email_activation"].includes(ev.source);

  reprocessButton.disabled = !canReprocess;
  documentButton.disabled = false;
  emailDocumentButton.disabled = !ev.result?.merged;

  reprocessButton.onclick = async () => {
    try {
      const res = await apiFetch(`/api/v1/processing-events/${id}/reprocess`, { method: "POST" });
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
      console.error("reprocess failed", error);
    }
  };

  documentButton.onclick = () => {
    window.open(`/api/v1/processing-events/${id}/document?format=pdf`, "_blank", "noopener");
  };

  emailDocumentButton.onclick = async () => {
    try {
      emailDocumentButton.disabled = true;
      const res = await apiFetch(`/api/v1/processing-events/${id}/send-document`, { method: "POST" });
      const payload = await res.json().catch(() => ({}));
      if (!res.ok) {
        const missing = Array.isArray(payload.missing_configuration)
          ? payload.missing_configuration.map((item) => `${item.label}: ${item.detail}`)
          : [];
        showToast({
          title: payload.error || "Invio email non riuscito",
          message: missing.length
            ? "Non sono state configurate queste cose:"
            : payload.detail || `HTTP ${res.status}`,
          items: missing,
          tone: "error",
        });
        return;
      }
      showToast({
        title: "Email inviata",
        message: `Documento inviato a ${(payload.recipients || []).join(", ") || "destinatari configurati"}.`,
        tone: "info",
      });
      await selectEvent(id);
    } catch (error) {
      console.error("send document failed", error);
      showToast({
        title: "Invio email non riuscito",
        message: error.message || String(error),
        tone: "error",
      });
    } finally {
      emailDocumentButton.disabled = !getCurrentEvent()?.result?.merged;
    }
  };
}
