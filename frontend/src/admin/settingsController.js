import { apiFetch } from "./apiClient.js";
import { qs } from "./dom.js";
import { formatEventTimestamp } from "./dateFormat.js";
import { showToast } from "./toast.js";

const settingsInputIds = {
  processing_ui_token: "processingUiToken",
  zapier_webhook_token: "zapierWebhookToken",
  admin_session_secret: "adminSessionSecret",
  ai_api_key: "aiApiKey",
  ai_base_url: "aiBaseUrl",
  ai_model: "aiModel",
  ai_memory_enabled: "aiMemoryEnabled",
  ai_memory_examples_limit: "aiMemoryExamplesLimit",
  geocoder_provider: "geocoderProvider",
  nominatim_base_url: "nominatimBaseUrl",
  nominatim_user_agent: "nominatimUserAgent",
  pdf_app_api_key: "pdfAppApiKey",
  pdf_app_ocr_endpoint: "pdfAppOcrEndpoint",
  pdf_app_job_endpoint: "pdfAppJobEndpoint",
  document_template_url: "documentTemplateUrl",
  document_send_to: "documentSendTo",
  smtp_host: "smtpHost",
  smtp_port: "smtpPort",
  smtp_secure: "smtpSecure",
  smtp_user: "smtpUser",
  smtp_password: "smtpPassword",
  smtp_from: "smtpFrom",
  email_watcher_enabled: "emailWatcherEnabled",
  email_watcher_imap_host: "emailWatcherImapHost",
  email_watcher_imap_port: "emailWatcherImapPort",
  email_watcher_imap_secure: "emailWatcherImapSecure",
  email_watcher_from_allowlist: "emailWatcherFromAllowlist",
  email_watcher_required_filename: "emailWatcherRequiredFilename",
  email_watcher_poll_seconds: "emailWatcherPollSeconds",
  immobiliare_scraper_provider: "immobiliareScraperProvider",
  apify_token: "apifyToken",
  apify_immobiliare_actor_id: "apifyImmobiliareActorId",
  apify_immobiliare_input_template: "apifyImmobiliareInputTemplate",
};

export function suggestModelBasedOnBaseUrl() {
  const baseInput = qs("aiBaseUrl");
  const modelInput = qs("aiModel");
  if (!baseInput || !modelInput) return;
  const base = String(baseInput.value || "").toLowerCase();

  let hint = qs("aiModelHint");
  if (!hint) {
    hint = document.createElement("div");
    hint.id = "aiModelHint";
    hint.style.fontSize = "12px";
    hint.style.color = "#647084";
    hint.style.marginTop = "6px";
    modelInput.parentNode.appendChild(hint);
  }

  if (base.includes("openrouter")) {
    if (!modelInput.value || modelInput.value.startsWith("openai/")) {
      modelInput.value = modelInput.value && modelInput.value.startsWith("openai/")
        ? modelInput.value.replace(/^openai\//, "")
        : "gpt-4o-mini";
    }
    hint.textContent = 'Suggerimento: OpenRouter usa il modello senza prefisso provider (es. "gpt-4o-mini").';
  } else {
    hint.textContent = "";
  }
}

function initSettingsSectionView() {
  const search = qs("settingsSectionSearch");
  const tabs = Array.from(document.querySelectorAll("[data-settings-tab]"));
  const sections = Array.from(document.querySelectorAll("[data-settings-section]"));
  if (!tabs.length || !sections.length) return;

  const activate = (sectionId) => {
    tabs.forEach((tab) => {
      const active = tab.dataset.settingsTab === sectionId;
      tab.classList.toggle("active", active);
      tab.setAttribute("aria-selected", String(active));
    });
    sections.forEach((section) => {
      section.hidden = section.dataset.settingsSection !== sectionId;
    });
  };

  tabs.forEach((tab) => {
    tab.addEventListener("click", () => activate(tab.dataset.settingsTab));
  });

  if (search) {
    search.addEventListener("input", () => {
      const query = String(search.value || "").trim().toLowerCase();
      const visibleTabs = tabs.filter((tab) => {
        const visible = !query || tab.textContent.toLowerCase().includes(query);
        tab.hidden = !visible;
        return visible;
      });
      if (visibleTabs.length && !visibleTabs.some((tab) => tab.classList.contains("active"))) {
        activate(visibleTabs[0].dataset.settingsTab);
      }
    });
  }
}

function watcherScanSummary(result) {
  if (result.busy) return "Watcher gia in esecuzione, riprova tra poco.";
  if (result.enabled === false) return "Watcher disabilitato: imposta Watcher Email su true e salva.";
  if (result.disabled_reason) return `Watcher non avviato: ${result.disabled_reason}.`;
  const summary = [
    `Lette ${result.scanned || 0}`,
    `processate ${result.accepted || 0}`,
    `duplicate ${result.duplicates || 0}`,
    `mittente escluso ${result.skipped_sender || 0}`,
    `file escluso ${result.skipped_filename || 0}`,
    `vecchie ignorate ${result.skipped_before_baseline || 0}`,
  ].join(" · ");
  const diagnostics = (result.diagnostics || []).slice(-3).map((item) => {
    const from = (item.from || []).join(", ") || "-";
    const files = (item.filenames || []).join(", ") || "nessun allegato";
    return `${item.reason}: ${item.subject || "senza oggetto"} | from ${from} | file ${files}`;
  });
  return diagnostics.length ? `${summary}\n${diagnostics.join("\n")}` : summary;
}

async function fetchProcessingEvents(limit = 50) {
  const resp = await apiFetch(`/api/v1/processing-events?limit=${limit}`);
  const payload = await resp.json().catch(() => ({}));
  if (!resp.ok || payload.ok === false) {
    throw new Error(payload.error || `HTTP ${resp.status}`);
  }
  return payload.events || [];
}

async function fetchProcessingEvent(id) {
  const resp = await apiFetch(`/api/v1/processing-events/${id}`);
  const payload = await resp.json().catch(() => ({}));
  if (!resp.ok || payload.ok === false) {
    throw new Error(payload.error || `HTTP ${resp.status}`);
  }
  return payload.event;
}

async function fetchMailboxSyncStatus() {
  const resp = await apiFetch("/api/v1/admin/mailbox/sync/status");
  const payload = await resp.json().catch(() => ({}));
  if (!resp.ok || payload.ok === false) {
    throw new Error(payload.error || `HTTP ${resp.status}`);
  }
  return payload.sync || {};
}

async function fetchMailboxMessages(limit = 20) {
  const resp = await apiFetch(`/api/v1/admin/mailbox/messages?limit=${limit}&include_all_senders=true`);
  const payload = await resp.json().catch(() => ({}));
  if (!resp.ok || payload.ok === false) {
    throw new Error(payload.error || payload.disabled_reason || `HTTP ${resp.status}`);
  }
  return payload.messages || [];
}

async function findLatestDetailedEvent(predicate) {
  const events = await fetchProcessingEvents(50);
  for (const event of events) {
    const detail = await fetchProcessingEvent(event.id);
    if (predicate(detail)) return detail;
  }
  return null;
}

function errorMessageFromPayload(payload, fallback) {
  const missing = Array.isArray(payload.missing_configuration)
    ? payload.missing_configuration.map((item) => `${item.label}: ${item.detail}`).join(" · ")
    : "";
  return missing || payload.detail || payload.error || fallback;
}

function localDateTimeInputValue(date) {
  const pad = (value) => String(value).padStart(2, "0");
  return [
    date.getFullYear(),
    "-",
    pad(date.getMonth() + 1),
    "-",
    pad(date.getDate()),
    "T",
    pad(date.getHours()),
    ":",
    pad(date.getMinutes()),
  ].join("");
}

function startOfTodayInputValue() {
  const date = new Date();
  date.setHours(0, 0, 0, 0);
  return localDateTimeInputValue(date);
}

function compactElapsed(value) {
  if (!value) return "-";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "-";
  const seconds = Math.max(0, Math.round((Date.now() - date.getTime()) / 1000));
  if (seconds < 60) return `${seconds}s fa`;
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes}m fa`;
  const hours = Math.round(minutes / 60);
  return `${hours}h fa`;
}

function clearNode(node) {
  while (node?.firstChild) node.removeChild(node.firstChild);
}

function appendText(parent, tag, text, className = "") {
  const element = document.createElement(tag);
  if (className) element.className = className;
  element.textContent = text;
  parent.appendChild(element);
  return element;
}

function appendDiagnosticCard(parent, { title, meta = "", tone = "info", rows = [] }) {
  const card = document.createElement("article");
  card.className = `diagnostic-card ${tone}`;
  const header = document.createElement("div");
  header.className = "diagnostic-card-header";
  appendText(header, "strong", title);
  if (meta) appendText(header, "span", meta);
  card.appendChild(header);
  rows.filter(Boolean).forEach((row) => appendText(card, "p", row));
  parent.appendChild(card);
  return card;
}

function stepLabel(step) {
  if (!step) return "Nessuno step registrato.";
  const detail = step.data?.file_name || step.data?.reason || step.data?.error || "";
  return [step.message || "Step senza nome", detail ? `(${detail})` : ""].filter(Boolean).join(" ");
}

function operationFromStep(step) {
  const message = String(step?.message || "");
  const fileName = step?.data?.file_name || step?.data?.url || "documento";
  const isStarted = /started/i.test(message);
  const isCompleted = /completed|extracted|scraped|sent/i.test(message);
  const isFailed = step?.level === "error" || /failed/i.test(message);
  const state = isFailed ? "Errore" : isStarted ? "In corso" : isCompleted ? "Processato" : "Stato";

  if (/PDF-app OCR|Local PDF text extraction/i.test(message)) {
    return `${state}: OCR del documento ${fileName}`;
  }
  if (/DOCX text extraction/i.test(message)) {
    return `${state}: lettura DOCX ${fileName}`;
  }
  if (/Proposal AI extraction/i.test(message)) {
    return `${state}: analisi AI proposta ${fileName}`;
  }
  if (/Announcement AI extraction/i.test(message)) {
    return `${state}: analisi AI annuncio ${fileName}`;
  }
  if (/Commission AI extraction/i.test(message)) {
    return `${state}: analisi AI provvigione ${fileName}`;
  }
  if (/Immobiliare\.it announcement scrape/i.test(message)) {
    return `${state}: acquisizione Immobiliare.it ${fileName}`;
  }
  if (/Automatic document email|Document email/i.test(message)) {
    return `${state}: invio documento`;
  }
  return `${state}: ${stepLabel(step)}`;
}

function currentOperationLabel(event) {
  const steps = Array.isArray(event.steps) ? event.steps : [];
  const lastInteresting = [...steps]
    .reverse()
    .find((step) => /started|completed|extracted|scraped|failed|sent/i.test(step.message || "") || step.level === "error");
  return lastInteresting ? operationFromStep(lastInteresting) : "Nessuna operazione lunga registrata.";
}

function eventTone(event) {
  if (event.status === "failed" || event.error || event.steps?.some((step) => step.level === "error")) return "bad";
  if (event.status === "completed" || event.result?.ready_for_zapier) return "done";
  return "warn";
}

function eventRows(event) {
  const steps = Array.isArray(event.steps) ? event.steps : [];
  const lastStep = steps.at(-1);
  const errors = steps.filter((step) => step.level === "error").slice(-3);
  const missing = Array.isArray(event.error?.missing_fields) ? event.error.missing_fields.slice(0, 4) : [];
  const rows = [
    `Adesso: ${currentOperationLabel(event)}`,
    `Ultimo step: ${stepLabel(lastStep)}`,
    `Aggiornato: ${formatEventTimestamp(event.updated_at)} (${compactElapsed(event.updated_at)})`,
  ];
  errors.forEach((step) => rows.push(`Errore: ${stepLabel(step)}`));
  missing.forEach((field) => rows.push(`Mancante: ${field.field || field.path || field.message}`));
  if (!errors.length && !missing.length && event.status !== "completed") {
    rows.push("Nessun errore registrato finora: se resta fermo, controlla quanto tempo fa si e aggiornato.");
  }
  return rows;
}

function renderDiagnostics({ sync, mailboxMessages, events }) {
  const pane = qs("diagnosticsPane");
  const status = qs("diagnosticsStatus");
  if (!pane || !status) return;

  clearNode(pane);
  status.textContent = `Aggiornato ${formatEventTimestamp(new Date().toISOString())}.`;

  appendDiagnosticCard(pane, {
    title: sync.running ? "Sync mailbox in corso" : "Sync mailbox ferma",
    meta: sync.last_error ? "errore" : "ok",
    tone: sync.last_error ? "bad" : sync.running ? "warn" : "done",
    rows: [
      `Ultimo avvio: ${formatEventTimestamp(sync.last_started_at)}`,
      `Ultima fine: ${formatEventTimestamp(sync.last_finished_at)}`,
      sync.last_error ? `Errore sync: ${sync.last_error}` : null,
      sync.last_result
        ? `Ultimo risultato: ${sync.last_result.scanned || 0} scansionate, ${sync.last_result.count || 0} indicizzate.`
        : "Nessun risultato sync registrato.",
    ],
  });

  const pendingMailbox = mailboxMessages
    .filter((message) => !message.event_id && (message.interceptor?.processable || message.required_filename_match))
    .slice(0, 6);
  appendDiagnosticCard(pane, {
    title: pendingMailbox.length ? "Mail processabili senza evento" : "Mailbox senza code evidenti",
    meta: `${pendingMailbox.length} mail`,
    tone: pendingMailbox.length ? "warn" : "done",
    rows: pendingMailbox.length
      ? pendingMailbox.map((message) =>
          `${message.seen ? "letta" : "non letta"} · ${message.subject || "(senza oggetto)"} · uid ${message.uid || "-"}`
        )
      : ["Le mail recenti indicizzate hanno gia un evento o non passano i filtri."],
  });

  if (!events.length) {
    appendDiagnosticCard(pane, {
      title: "Nessun evento pipeline recente",
      tone: "warn",
      rows: ["La pipeline non ha eventi recenti da mostrare."],
    });
    return;
  }

  events.forEach((event) => {
    appendDiagnosticCard(pane, {
      title: event.metadata?.subject || event.id,
      meta: `${event.source || "-"} · ${event.status || "-"} · ${event.steps?.length || 0} step`,
      tone: eventTone(event),
      rows: eventRows(event),
    });
  });
}

export function createSettingsController() {
  let diagnosticsTimer = null;
  let diagnosticsLoading = false;

  async function loadSettings() {
    try {
      const resp = await apiFetch("/api/v1/admin/settings?reveal=1");
      if (!resp.ok) throw new Error("Unable to fetch settings");
      const data = await resp.json();
      const settings = data.settings || {};
      Object.entries(settings).forEach(([key, val]) => {
        const id = settingsInputIds[key];
        if (id) qs(id).value = val || "";
      });
      suggestModelBasedOnBaseUrl();
    } catch (err) {
      console.error("loadSettings", err);
    }
  }

  async function saveSettings(e) {
    e.preventDefault();
    const form = qs("settingsForm");
    const formData = new FormData(form);
    const body = {};
    for (const [k, v] of formData.entries()) {
      body[k] = v;
    }
    try {
      const resp = await apiFetch("/api/v1/admin/settings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await resp.json();
      qs("settingsStatus").textContent = data.ok ? "Salvato" : `Errore: ${data.error || "unknown"}`;
      setTimeout(() => {
        qs("settingsStatus").textContent = "";
      }, 3000);
      await loadSettings();
    } catch (err) {
      qs("settingsStatus").textContent = "Errore salvataggio";
      console.error("saveSettings", err);
    }
  }

  function initRevealButtons() {
    document.querySelectorAll(".reveal-button").forEach((btn) => {
      btn.addEventListener("click", () => {
        const targetId = btn.dataset.reveal;
        const inp = qs(targetId);
        if (!inp) return;
        inp.type = inp.type === "password" ? "text" : "password";
      });
    });
  }

  function initWatcherScanButton() {
    const button = qs("manualWatcherScanButton");
    const status = qs("manualWatcherScanStatus");
    if (!button || !status) return;

    button.addEventListener("click", async () => {
      button.disabled = true;
      status.textContent = "Scansione watcher in corso...";
      try {
        const resp = await apiFetch("/api/v1/admin/email-watcher/scan", { method: "POST" });
        const payload = await resp.json().catch(() => ({}));
        const message = watcherScanSummary(payload);
        status.textContent = message;
        showToast({
          title: payload.busy ? "Scansione gia in corso" : resp.ok ? "Scansione completata" : "Scansione non completata",
          message: payload.error || message,
          tone: resp.ok || payload.busy ? "info" : "error",
        });
      } catch (error) {
        const message = error.message || String(error);
        status.textContent = `Scansione fallita: ${message}`;
        showToast({ title: "Scansione fallita", message, tone: "error" });
      } finally {
        button.disabled = false;
      }
    });
  }

  function initWatcherResetStateButton() {
    const button = qs("manualWatcherResetStateButton");
    const status = qs("manualWatcherScanStatus");
    if (!button || !status) return;

    button.addEventListener("click", async () => {
      button.disabled = true;
      status.textContent = "Svuoto lo state del watcher...";
      try {
        const resp = await apiFetch("/api/v1/admin/email-watcher/state/reset", { method: "POST" });
        const payload = await resp.json().catch(() => ({}));
        if (!resp.ok || payload.ok === false) {
          const message = payload.error || `HTTP ${resp.status}`;
          status.textContent = `Reset state non riuscito: ${message}`;
          showToast({ title: "Reset state non riuscito", message, tone: "error" });
          return;
        }

        status.textContent = "State watcher svuotato. Rimarca la mail come non letta e avvia una scansione.";
        showToast({ title: "State watcher svuotato", message: status.textContent, tone: "info" });
      } catch (error) {
        const message = error.message || String(error);
        status.textContent = `Reset state fallito: ${message}`;
        showToast({ title: "Reset state fallito", message, tone: "error" });
      } finally {
        button.disabled = false;
      }
    });
  }

  function initWatcherIgnoreBeforeButton() {
    const input = qs("manualWatcherIgnoreBeforeInput");
    const button = qs("manualWatcherIgnoreBeforeButton");
    const status = qs("manualWatcherScanStatus");
    if (!input || !button || !status) return;

    if (!input.value) input.value = startOfTodayInputValue();

    button.addEventListener("click", async () => {
      if (!input.value) {
        status.textContent = "Seleziona giorno e ora della baseline.";
        return;
      }

      button.disabled = true;
      status.textContent = "Imposto la baseline del watcher...";
      try {
        const ignoreBefore = new Date(input.value).toISOString();
        const resp = await apiFetch("/api/v1/admin/email-watcher/state/ignore-before", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ ignore_before: ignoreBefore }),
        });
        const payload = await resp.json().catch(() => ({}));
        if (!resp.ok || payload.ok === false) {
          const message = payload.error || `HTTP ${resp.status}`;
          status.textContent = `Baseline non impostata: ${message}`;
          showToast({ title: "Baseline non impostata", message, tone: "error" });
          return;
        }

        status.textContent = `Baseline impostata: le mail prima di ${payload.ignore_before} saranno ignorate.`;
        showToast({ title: "Vecchie mail ignorate", message: status.textContent, tone: "info" });
      } catch (error) {
        const message = error.message || String(error);
        status.textContent = `Baseline non impostata: ${message}`;
        showToast({ title: "Baseline non impostata", message, tone: "error" });
      } finally {
        button.disabled = false;
      }
    });
  }

  function initManualSendLatestDocumentButton() {
    const button = qs("manualSendLatestDocumentButton");
    const status = qs("manualSendLatestDocumentStatus");
    if (!button || !status) return;

    button.addEventListener("click", async () => {
      button.disabled = true;
      status.textContent = "Cerco l'ultimo documento processato...";
      try {
        const event = await findLatestDetailedEvent((candidate) => Boolean(candidate?.result?.merged));
        if (!event) {
          status.textContent = "Nessun evento con dati merged disponibili.";
          showToast({ title: "Documento non trovato", message: status.textContent, tone: "error" });
          return;
        }

        status.textContent = `Invio documento evento ${event.id}...`;
        const resp = await apiFetch(`/api/v1/processing-events/${event.id}/send-document`, {
          method: "POST",
        });
        const payload = await resp.json().catch(() => ({}));
        if (!resp.ok || payload.ok === false) {
          const message = errorMessageFromPayload(payload, `HTTP ${resp.status}`);
          status.textContent = `Invio non riuscito: ${message}`;
          showToast({ title: "Invio non riuscito", message, tone: "error" });
          return;
        }

        const recipients = (payload.recipients || []).join(", ") || "destinatari configurati";
        status.textContent = `Documento inviato a ${recipients}.`;
        showToast({ title: "Documento inviato", message: status.textContent, tone: "info" });
      } catch (error) {
        const message = error.message || String(error);
        status.textContent = `Invio fallito: ${message}`;
        showToast({ title: "Invio fallito", message, tone: "error" });
      } finally {
        button.disabled = false;
      }
    });
  }

  function initManualAnalyzeLatestEmailButton() {
    const button = qs("manualAnalyzeLatestEmailButton");
    const status = qs("manualAnalyzeLatestEmailStatus");
    if (!button || !status) return;

    button.addEventListener("click", async () => {
      button.disabled = true;
      status.textContent = "Cerco l'ultima email ricevuta...";
      try {
        const events = await fetchProcessingEvents(50);
        const event = events.find((candidate) =>
          ["zapier.email_activation", "imap.email_activation"].includes(candidate.source)
        );
        if (!event) {
          status.textContent = "Nessuna email ricevuta trovata.";
          showToast({ title: "Email non trovata", message: status.textContent, tone: "error" });
          return;
        }

        status.textContent = `OCR e Analisi AI in corso per evento ${event.id}...`;
        const resp = await apiFetch(`/api/v1/processing-events/${event.id}/reprocess`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ skip_auto_send: true }),
        });
        const payload = await resp.json().catch(() => ({}));
        if (!resp.ok || payload.ok === false) {
          const message = errorMessageFromPayload(payload, `HTTP ${resp.status}`);
          status.textContent = `Analisi non riuscita: ${message}`;
          showToast({ title: "Analisi non riuscita", message, tone: "error" });
          return;
        }

        status.textContent = `OCR e Analisi AI completate per evento ${event.id}.`;
        showToast({ title: "Analisi completata", message: status.textContent, tone: "info" });
      } catch (error) {
        const message = error.message || String(error);
        status.textContent = `Analisi fallita: ${message}`;
        showToast({ title: "Analisi fallita", message, tone: "error" });
      } finally {
        button.disabled = false;
      }
    });
  }

  async function loadDiagnostics({ silent = false } = {}) {
    if (diagnosticsLoading) return;
    diagnosticsLoading = true;
    const button = qs("refreshDiagnosticsButton");
    const status = qs("diagnosticsStatus");
    if (button && !silent) button.disabled = true;
    if (status && !silent) status.textContent = "Carico diagnostica processi...";
    try {
      const [sync, mailboxMessages, eventSummaries] = await Promise.all([
        fetchMailboxSyncStatus(),
        fetchMailboxMessages(20),
        fetchProcessingEvents(12),
      ]);
      const detailedEvents = [];
      for (const summary of eventSummaries.slice(0, 8)) {
        const detail = await fetchProcessingEvent(summary.id);
        if (detail) detailedEvents.push(detail);
      }
      renderDiagnostics({ sync, mailboxMessages, events: detailedEvents });
    } catch (error) {
      if (status) status.textContent = `Diagnostica non disponibile: ${error.message || String(error)}`;
      if (!silent) showToast({ title: "Diagnostica non disponibile", message: error.message || String(error), tone: "error" });
    } finally {
      if (button) button.disabled = false;
      diagnosticsLoading = false;
    }
  }

  function initDiagnosticsLogger() {
    const button = qs("refreshDiagnosticsButton");
    if (button) button.addEventListener("click", () => loadDiagnostics());
    document.querySelector('[data-settings-tab="diagnostica"]')?.addEventListener("click", () => loadDiagnostics());
    if (diagnosticsTimer) window.clearInterval(diagnosticsTimer);
    diagnosticsTimer = window.setInterval(() => {
      const settingsVisible = !qs("settingsPage")?.hidden;
      const diagnosticsVisible = !document.querySelector('[data-settings-section="diagnostica"]')?.hidden;
      if (settingsVisible && diagnosticsVisible && !document.hidden) loadDiagnostics({ silent: true });
    }, 3_000);
  }

  return {
    initSettingsSectionView,
    initRevealButtons,
    initManualAnalyzeLatestEmailButton,
    initManualSendLatestDocumentButton,
    initWatcherIgnoreBeforeButton,
    initWatcherResetStateButton,
    initWatcherScanButton,
    initDiagnosticsLogger,
    loadDiagnostics,
    loadSettings,
    saveSettings,
    suggestModelBasedOnBaseUrl,
  };
}
