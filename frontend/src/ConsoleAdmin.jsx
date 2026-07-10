const settingsFields = [
  ["processingUiToken", "processing_ui_token", "Token UI", "Token per le API della UI", "off", "password"],
  ["zapierWebhookToken", "zapier_webhook_token", "Token Webhook Zapier", "Token richiesto dagli hook Zapier", "off", "password"],
  ["adminSessionSecret", "admin_session_secret", "Session Secret", "Secret per firmare la sessione admin", "off", "password"],
  ["aiApiKey", "ai_api_key", "AI API Key", "Chiave API OpenRouter/OpenAI", "off", "password"],
  ["aiBaseUrl", "ai_base_url", "AI Base URL", "https://openrouter.ai/api/v1", "off", "text"],
  ["aiModel", "ai_model", "AI Model", "openai/gpt-4o-mini", "off", "text"],
  ["pdfAppApiKey", "pdf_app_api_key", "PDF-app API Key", "API key PDF-app.net", "off", "password"],
  ["pdfAppOcrEndpoint", "pdf_app_ocr_endpoint", "PDF-app OCR Endpoint", "Endpoint OCR 2.0 PDF-app.net", "off", "text"],
  ["pdfAppJobEndpoint", "pdf_app_job_endpoint", "PDF-app Job Endpoint", "Endpoint polling job async, opzionale", "off", "text"],
  ["documentTemplateUrl", "document_template_url", "Template Documento", "Link Google Doc template con placeholder {{campo}}", "off", "text"],
  ["documentSendTo", "document_send_to", "Send to", "email@dominio.it, altra@dominio.it", "off", "text"],
  ["smtpHost", "smtp_host", "SMTP Host", "smtp.gmail.com", "off", "text"],
  ["smtpPort", "smtp_port", "SMTP Port", "465 o 587", "off", "text"],
  ["smtpSecure", "smtp_secure", "SMTP Secure", "true per 465, false per 587", "off", "text"],
  ["smtpUser", "smtp_user", "SMTP User", "account@dominio.it", "off", "text"],
  ["smtpPassword", "smtp_password", "SMTP Password", "App password o password SMTP", "off", "password"],
  ["smtpFrom", "smtp_from", "SMTP From", "mittente@dominio.it", "off", "text"],
  ["emailWatcherEnabled", "email_watcher_enabled", "Watcher Email", "true o false", "off", "text"],
  ["emailWatcherImapHost", "email_watcher_imap_host", "IMAP Host", "imap.gmail.com", "off", "text"],
  ["emailWatcherImapPort", "email_watcher_imap_port", "IMAP Port", "993", "off", "text"],
  ["emailWatcherImapSecure", "email_watcher_imap_secure", "IMAP Secure", "true", "off", "text"],
  ["emailWatcherFromAllowlist", "email_watcher_from_allowlist", "Mittenti autorizzati", "email@dominio.it, altra@dominio.it", "off", "text"],
  ["emailWatcherRequiredFilename", "email_watcher_required_filename", "File richiesto", "proposta", "off", "text"],
  ["emailWatcherPollSeconds", "email_watcher_poll_seconds", "Polling watcher sec", "120", "off", "text"],
  ["adminPassword", "admin_password", "Nuova Password Admin", "Lascia vuoto per non cambiarla", "new-password", "password"],
];

export default function ConsoleAdmin() {
  return (
    <div id="settingsModal" className="modal-backdrop console-admin-backdrop" hidden>
      <section className="modal modal-fullscreen" role="dialog" aria-modal="true" aria-labelledby="settingsTitle">
        <header className="modal-header">
          <div>
            <p className="eyebrow">Console Admin</p>
            <h2 id="settingsTitle">Impostazioni</h2>
          </div>
          <button id="closeSettingsButton" className="icon-button" type="button" title="Chiudi">
            <span className="material-symbols-outlined" aria-hidden="true">close</span>
          </button>
        </header>
        <div className="console-admin-content">
          <form id="settingsForm" className="settings-form">
            {settingsFields.map(([id, name, label, placeholder, autocomplete, inputType]) => (
              <label key={id}>
                <span>{label}</span>
                <div className={inputType === "password" ? "secret-field" : "plain-field"}>
                  <input id={id} name={name} type={inputType} autoComplete={autocomplete} placeholder={placeholder} />
                  {inputType === "password" ? (
                    <button className="icon-button reveal-button" type="button" data-reveal={id} title="Mostra">
                      <span className="material-symbols-outlined" aria-hidden="true">visibility</span>
                    </button>
                  ) : null}
                </div>
              </label>
            ))}
            <div className="modal-actions">
              <p id="settingsStatus" className="settings-status"></p>
              <button type="submit" className="primary-button">Salva</button>
            </div>
          </form>
          <section className="settings-summary">
            <h3>Valori salvati</h3>
            <div id="settingsPane" className="settings-cards"></div>
          </section>
        </div>
      </section>
    </div>
  );
}
