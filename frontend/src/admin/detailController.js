import { apiFetch } from "./apiClient.js";
import { formatEventTimestamp } from "./dateFormat.js";
import { fileNameFromStep, renderFileSections, renderPipelineSteps } from "./fileSections.js";
import { renderStructured } from "./structuredView.js";
import { showToast } from "./toast.js";
import { renderWorkflowStatus } from "./workflowView.js";

function mailboxState(message) {
  if (message.event_id) {
    return {
      label: message.seen ? "Letta e processata" : "Processata",
      issue: null,
      notes: ["La mail ha un evento pipeline collegato."],
    };
  }
  if (message.before_baseline) {
    return {
      label: "Vecchia ignorata",
      issue: null,
      notes: [
        "La mail e precedente alla baseline del watcher e non verra processata automaticamente.",
        `Baseline watcher: ${formatEventTimestamp(message.ignore_before)}`,
      ],
    };
  }
  if (message.sender_allowed === false) {
    return {
      label: "Mittente escluso",
      issue: `Mittente non autorizzato: ${(message.from || []).join(", ") || "-"}.`,
      notes: [
        `Allowlist configurata: ${(message.allowed_from || []).join(", ") || "vuota"}.`,
        "Aggiungi questo mittente ai Mittenti autorizzati oppure inoltra da un mittente gia autorizzato.",
      ],
    };
  }
  if (!message.required_filename_match) {
    return {
      label: "Scartata",
      issue: `File richiesto non trovato: ${message.required_filename || "proposta"}.`,
      notes: ["La mail non passa il filtro allegato configurato nel watcher."],
    };
  }
  if (message.processed) {
    return {
      label: "State senza evento",
      issue: "La mail risulta nello state, ma non esiste un evento collegato.",
      notes: ["Cancella lo state della singola mail dal menu a tre puntini per permettere un nuovo tentativo."],
    };
  }
  if (message.interceptor?.processable) {
    return {
      label: message.seen ? "Letta processabile" : "Da processare",
      issue: null,
      notes: ["La mail e valida: puoi processarla manualmente dalla toolbar."],
    };
  }
  if (message.seen) {
    return {
      label: "Letta non processata",
      issue: "La mail e letta: il watcher automatico la ignora finche non viene marcata non letta.",
      notes: ["Marca la mail come non letta nella casella e avvia una scansione watcher."],
    };
  }
  return {
    label: "Da processare",
    issue: "La mail e non letta e valida: avvia una scansione watcher.",
    notes: ["La prossima scansione dovrebbe creare una lavorazione se IMAP e configurato correttamente."],
  };
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
  delete result.immobiliare;
  return result;
}

function renderFeedbackForm(event, selectEvent) {
  const resultPane = document.getElementById("resultPane");
  if (!resultPane || !event?.result) return;

  const section = document.createElement("details");
  section.className = "data-section feedback-section";
  section.open = false;

  const summary = document.createElement("summary");
  summary.textContent = "Correggi estrazione AI";
  section.appendChild(summary);

  const form = document.createElement("form");
  form.className = "feedback-form";
  form.innerHTML = `
    <label>
      Campo
      <input name="field_path" placeholder="extracted.proposta.indirizzo_immobile" required />
    </label>
    <label>
      Valore corretto
      <textarea name="corrected_value" rows="3" required></textarea>
    </label>
    <label>
      Fonte / file
      <input name="source_file" placeholder="Proposta.pdf" />
    </label>
    <label>
      Motivo
      <textarea name="reason" rows="2" placeholder="Dato letto male, OCR incompleto, regola nuova..."></textarea>
    </label>
    <label class="feedback-check">
      <input name="apply" type="checkbox" checked />
      Applica correzione a questo evento
    </label>
    <button class="secondary-button" type="submit">Salva feedback</button>
  `;

  form.onsubmit = async (submitEvent) => {
    submitEvent.preventDefault();
    const data = new FormData(form);
    const payload = {
      field_path: String(data.get("field_path") || "").trim(),
      corrected_value: String(data.get("corrected_value") || "").trim(),
      source_file: String(data.get("source_file") || "").trim(),
      reason: String(data.get("reason") || "").trim(),
      apply: data.get("apply") === "on",
    };
    try {
      const res = await apiFetch(`/api/v1/processing-events/${event.id}/feedback`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload),
      });
      const responsePayload = await res.json().catch(() => ({}));
      if (!res.ok) {
        showToast({
          title: "Feedback non salvato",
          message: responsePayload.error || `HTTP ${res.status}`,
          tone: "error",
        });
        return;
      }
      showToast({
        title: "Feedback salvato",
        message: payload.apply ? "La correzione e stata applicata all'evento." : "Esempio salvato nel dataset feedback.",
        tone: "info",
      });
      form.reset();
      form.elements.apply.checked = true;
      await selectEvent(event.id);
    } catch (error) {
      showToast({
        title: "Feedback non salvato",
        message: error.message || String(error),
        tone: "error",
      });
    }
  };

  section.appendChild(form);
  resultPane.prepend(section);
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

function setReprocessButtonProcessing(button, processing, title = "Riprocessa") {
  if (!button) return;
  button.classList.toggle("is-processing", processing);
  button.setAttribute("aria-busy", String(processing));
  button.title = processing ? "Elaborazione in corso" : title;
  button.disabled = processing;
}

export function createDetailController() {
  let currentEvent = null;

  function selectMailboxMessage(message) {
    currentEvent = null;
    const state = mailboxState(message);

    document.getElementById("selectedTitle").textContent = message.subject || "(senza oggetto)";
    document.getElementById("selectedSource").textContent = `imap.mailbox · ${state.label}`;
    document.getElementById("receivedAt").textContent = formatEventTimestamp(message.date);
    document.getElementById("updatedAt").textContent = "-";
    document.getElementById("fileCount").textContent = Array.isArray(message.filenames) ? message.filenames.length : "-";

    renderWorkflowStatus({
      status: message.processed ? "received" : "processing",
      error: message.required_filename_match ? null : { message: "File richiesto non trovato." },
      steps: [],
    });

    renderStructured(document.getElementById("requestPane"), {
      id: message.id,
      uid: message.uid,
      from: message.from,
      to: message.to,
      subject: message.subject,
      date: message.date,
      seen: message.seen,
      sender_allowed: message.sender_allowed,
      allowed_from: message.allowed_from,
      processed_state: message.processed,
      before_baseline: message.before_baseline,
      ignore_before: message.ignore_before,
      required_filename_match: message.required_filename_match,
      required_filename: message.required_filename,
      filenames: message.filenames,
      event_id: message.event_id,
    }, "Nessun dato mailbox.");
    renderStructured(document.getElementById("stepsPane"), [], "Questa mail non ha ancora un log pipeline.");
    renderStructured(document.getElementById("filesPane"), message.filenames || [], "Nessun allegato.");
    renderStructured(document.getElementById("immobiliarePane"), {}, "Nessun dato immobiliare acquisito.");
    renderStructured(document.getElementById("resultPane"), {}, "Nessun dato estratto.");
    renderStructured(document.getElementById("notesPane"), [
      ...(state.issue ? [state.issue] : []),
      ...state.notes,
      message.processed
        ? "Lo state contiene questa email."
        : "Lo state non contiene questa email.",
    ], "Nessuna nota.");
    renderStructured(document.getElementById("missingFieldsPane"), [], "Nessun campo mancante.");
    renderStructured(document.getElementById("errorPane"), [], "Nessun errore pipeline.");

    const reprocessButton = document.getElementById("reprocessButton");
    const documentButton = document.getElementById("documentButton");
    const emailDocumentButton = document.getElementById("emailDocumentButton");
    const canProcessMailboxMessage = Boolean(message.interceptor?.processable && message.uid);
    reprocessButton.disabled = !canProcessMailboxMessage;
    reprocessButton.title = "Processa";
    documentButton.disabled = true;
    emailDocumentButton.disabled = true;
    reprocessButton.onclick = canProcessMailboxMessage
      ? async () => {
          try {
            setReprocessButtonProcessing(reprocessButton, true, "Processa");
            documentButton.disabled = true;
            emailDocumentButton.disabled = true;
            renderWorkflowStatus({
              __processing: true,
              status: "extracting",
              received_at: message.date || new Date().toISOString(),
              result: { attachments: (message.filenames || []).map((file_name) => ({ file_name })) },
              steps: [],
            });
            const resp = await apiFetch("/api/v1/admin/mailbox/messages/process", {
              method: "POST",
              headers: { "content-type": "application/json" },
              body: JSON.stringify({ uid: message.uid, message_id: message.id }),
            });
            const payload = await resp.json().catch(() => ({}));
            if (!resp.ok || payload.ok === false) {
              showToast({
                title: "Processo mail non avviato",
                message: payload.error || `HTTP ${resp.status}`,
                tone: "error",
              });
              return;
            }
            showToast({
              title: payload.duplicate ? "Evento gia presente" : "Mail processata",
              message: payload.event_id ? `Evento ${payload.event_id}` : "Lavorazione creata.",
              tone: "info",
            });
            if (payload.event_id) await selectEvent(payload.event_id);
          } catch (error) {
            showToast({
              title: "Processo mail non avviato",
              message: error.message || String(error),
              tone: "error",
            });
          } finally {
            setReprocessButtonProcessing(reprocessButton, false, "Processa");
            reprocessButton.disabled = !canProcessMailboxMessage;
          }
        }
      : null;
    documentButton.onclick = null;
    emailDocumentButton.onclick = null;

    return message;
  }

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
      document.getElementById("receivedAt").textContent = formatEventTimestamp(ev.received_at);
      document.getElementById("updatedAt").textContent = formatEventTimestamp(ev.updated_at);
      document.getElementById("fileCount").textContent = Array.isArray(ev.request?.files) ? ev.request.files.length : "-";

      renderWorkflowStatus(ev);

      const requestPane = document.getElementById("requestPane");
      const emailData = ev.result?.email || {};
      renderStructured(requestPane, filteredRequestPayload(ev), "Nessun payload ricevuto.");
      renderEmailBodies(requestPane, emailData);

      renderPipelineSteps(ev);
      renderFileSections(ev);
      renderStructured(document.getElementById("immobiliarePane"), ev.result?.immobiliare || {}, "Nessun dato immobiliare acquisito.");
      renderStructured(document.getElementById("resultPane"), extractedResultView(ev), "Nessun dato estratto.", {
        feedbackEventId: ev.id,
      });
      renderFeedbackForm(ev, selectEvent);
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

  return { selectEvent, selectMailboxMessage };
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
      setReprocessButtonProcessing(reprocessButton, true);
      documentButton.disabled = true;
      emailDocumentButton.disabled = true;
      renderWorkflowStatus({ ...ev, __processing: true, status: "extracting" });
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
    } finally {
      const latestEvent = getCurrentEvent?.() || ev;
      setReprocessButtonProcessing(reprocessButton, false);
      reprocessButton.disabled = !canReprocess;
      documentButton.disabled = false;
      emailDocumentButton.disabled = !latestEvent.result?.merged;
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
