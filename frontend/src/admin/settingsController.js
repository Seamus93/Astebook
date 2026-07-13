import { apiFetch } from "./apiClient.js";
import { qs } from "./dom.js";
import { showToast } from "./toast.js";

const settingsInputIds = {
  processing_ui_token: "processingUiToken",
  zapier_webhook_token: "zapierWebhookToken",
  admin_session_secret: "adminSessionSecret",
  ai_api_key: "aiApiKey",
  ai_base_url: "aiBaseUrl",
  ai_model: "aiModel",
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
};

const settingsLabels = {
  processing_ui_token: "Token UI",
  zapier_webhook_token: "Token Webhook Zapier",
  admin_session_secret: "Session Secret",
  ai_api_key: "AI API Key",
  ai_base_url: "AI Base URL",
  ai_model: "AI Model",
  pdf_app_api_key: "PDF-app API Key",
  pdf_app_ocr_endpoint: "PDF-app OCR Endpoint",
  pdf_app_job_endpoint: "PDF-app Job Endpoint",
  document_template_url: "Template Documento",
  document_send_to: "Send to",
  smtp_host: "SMTP Host",
  smtp_port: "SMTP Port",
  smtp_secure: "SMTP Secure",
  smtp_user: "SMTP User",
  smtp_password: "SMTP Password",
  smtp_from: "SMTP From",
  email_watcher_enabled: "Watcher Email",
  email_watcher_imap_host: "IMAP Host",
  email_watcher_imap_port: "IMAP Port",
  email_watcher_imap_secure: "IMAP Secure",
  email_watcher_from_allowlist: "Mittenti autorizzati",
  email_watcher_required_filename: "File richiesto",
  email_watcher_poll_seconds: "Polling watcher sec",
};

function parseRecipientList(value) {
  return String(value || "")
    .split(/[,;\n]+/)
    .map((item) => item.trim())
    .filter(Boolean);
}

async function updateSingleSetting(key, value) {
  const resp = await apiFetch("/api/v1/admin/settings", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ [key]: value }),
  });
  const data = await resp.json().catch(() => ({}));
  if (!resp.ok || data.ok === false) {
    throw new Error(data.error || `HTTP ${resp.status}`);
  }
  return data;
}

function renderDocumentSendToCard(container, value, loadSettings) {
  const card = document.createElement("div");
  card.className = "setting-card setting-card-wide";

  const label = document.createElement("strong");
  label.textContent = settingsLabels.document_send_to;

  const body = document.createElement("div");
  body.className = "recipient-list";

  const recipients = parseRecipientList(value);
  if (!recipients.length) {
    const empty = document.createElement("span");
    empty.className = "empty-state";
    empty.textContent = "Nessun destinatario salvato.";
    body.appendChild(empty);
  } else {
    recipients.forEach((email) => {
      const chip = document.createElement("span");
      chip.className = "recipient-chip";

      const text = document.createElement("span");
      text.textContent = email;

      const remove = document.createElement("button");
      remove.type = "button";
      remove.className = "recipient-remove";
      remove.title = `Rimuovi ${email}`;
      remove.setAttribute("aria-label", `Rimuovi ${email}`);
      remove.innerHTML = '<span class="material-symbols-outlined" aria-hidden="true">close</span>';
      remove.addEventListener("click", async () => {
        const nextRecipients = recipients.filter((recipient) => recipient !== email);
        const nextValue = nextRecipients.join(", ");
        const input = qs("documentSendTo");
        if (input) input.value = nextValue;
        try {
          await updateSingleSetting("document_send_to", nextValue);
          showToast({ title: "Destinatario rimosso", message: email, tone: "info" });
          await loadSettings();
        } catch (error) {
          showToast({
            title: "Eliminazione non riuscita",
            message: error.message || String(error),
            tone: "error",
          });
        }
      });

      chip.append(text, remove);
      body.appendChild(chip);
    });
  }

  card.append(label, body);
  container.appendChild(card);
}

function renderSettingsSummary(settings, loadSettings) {
  const pane = qs("settingsPane");
  if (!pane) return;
  pane.innerHTML = "";

  Object.entries(settingsLabels).forEach(([key, labelText]) => {
    const value = settings[key] || "";
    if (key === "document_send_to") {
      renderDocumentSendToCard(pane, value, loadSettings);
      return;
    }

    const card = document.createElement("div");
    card.className = "setting-card";

    const label = document.createElement("strong");
    label.textContent = labelText;

    const text = document.createElement("span");
    text.textContent = value || "-";

    card.append(label, text);
    pane.appendChild(card);
  });
}

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

export function createSettingsController() {
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
      renderSettingsSummary(settings, loadSettings);
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

  return {
    initSettingsSectionView,
    initRevealButtons,
    loadSettings,
    saveSettings,
    suggestModelBasedOnBaseUrl,
  };
}
