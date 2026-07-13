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
  ai_memory_enabled: "aiMemoryEnabled",
  ai_memory_examples_limit: "aiMemoryExamplesLimit",
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
  return [
    `Lette ${result.scanned || 0}`,
    `processate ${result.accepted || 0}`,
    `duplicate ${result.duplicates || 0}`,
    `mittente escluso ${result.skipped_sender || 0}`,
    `file escluso ${result.skipped_filename || 0}`,
  ].join(" · ");
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
          title: resp.ok ? "Scansione completata" : "Scansione non completata",
          message: payload.error || message,
          tone: resp.ok ? "info" : "error",
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

  return {
    initSettingsSectionView,
    initRevealButtons,
    initWatcherScanButton,
    loadSettings,
    saveSettings,
    suggestModelBasedOnBaseUrl,
  };
}
