const settingsFields = [
  ["processingUiToken", "processing_ui_token", "Token UI", "Token per le API della UI", "off"],
  ["zapierWebhookToken", "zapier_webhook_token", "Token Webhook Zapier", "Token richiesto dagli hook Zapier", "off"],
  ["adminSessionSecret", "admin_session_secret", "Session Secret", "Secret per firmare la sessione admin", "off"],
  ["aiApiKey", "ai_api_key", "AI API Key", "Chiave API OpenRouter/OpenAI", "off"],
  ["aiBaseUrl", "ai_base_url", "AI Base URL", "https://openrouter.ai/api/v1", "off"],
  ["aiModel", "ai_model", "AI Model", "openai/gpt-4o-mini", "off"],
  ["pdfAppApiKey", "pdf_app_api_key", "PDF-app API Key", "API key PDF-app.net", "off"],
  ["pdfAppOcrEndpoint", "pdf_app_ocr_endpoint", "PDF-app OCR Endpoint", "Endpoint OCR 2.0 PDF-app.net", "off"],
  ["pdfAppJobEndpoint", "pdf_app_job_endpoint", "PDF-app Job Endpoint", "Endpoint polling job async, opzionale", "off"],
  ["documentTemplateUrl", "document_template_url", "Template Documento", "Link Google Doc template con placeholder {{campo}}", "off"],
  ["documentSendTo", "document_send_to", "Send to", "email@dominio.it, altra@dominio.it", "off"],
  ["smtpHost", "smtp_host", "SMTP Host", "smtp.gmail.com", "off"],
  ["smtpPort", "smtp_port", "SMTP Port", "465 o 587", "off"],
  ["smtpSecure", "smtp_secure", "SMTP Secure", "true per 465, false per 587", "off"],
  ["smtpUser", "smtp_user", "SMTP User", "account@dominio.it", "off"],
  ["smtpPassword", "smtp_password", "SMTP Password", "App password o password SMTP", "off"],
  ["smtpFrom", "smtp_from", "SMTP From", "mittente@dominio.it", "off"],
  ["adminPassword", "admin_password", "Nuova Password Admin", "Lascia vuoto per non cambiarla", "new-password"],
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
            {settingsFields.map(([id, name, label, placeholder, autocomplete]) => (
              <label key={id}>
                <span>{label}</span>
                <div className="secret-field">
                  <input id={id} name={name} type="password" autoComplete={autocomplete} placeholder={placeholder} />
                  <button className="icon-button reveal-button" type="button" data-reveal={id} title="Mostra">
                    <span className="material-symbols-outlined" aria-hidden="true">visibility</span>
                  </button>
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
