const settingsSections = [
  {
    title: "SMTP",
    icon: "outgoing_mail",
    open: true,
    fields: [
      ["smtpHost", "smtp_host", "SMTP Host", "smtp.gmail.com", "off", "text", "Server SMTP usato per inviare le email generate dalla pipeline."],
      ["smtpPort", "smtp_port", "SMTP Port", "465 o 587", "off", "text", "Porta di connessione SMTP. Di solito 465 con SSL oppure 587 con STARTTLS."],
      ["smtpSecure", "smtp_secure", "SMTP Secure", "true per 465, false per 587", "off", "text", "Imposta true quando la connessione SMTP parte già cifrata, tipicamente sulla porta 465."],
      ["smtpUser", "smtp_user", "SMTP User", "account@dominio.it", "off", "text", "Account email usato per autenticarsi sul server SMTP e, se non configurato diversamente, dal watcher IMAP."],
      ["smtpPassword", "smtp_password", "SMTP Password", "App password o password SMTP", "off", "password", "Password o app password dell'account SMTP. Lascia invariata se non vuoi cambiarla."],
      ["smtpFrom", "smtp_from", "SMTP From", "mittente@dominio.it", "off", "text", "Indirizzo mittente mostrato nelle email inviate da Astebook."],
    ],
  },
  {
    title: "Watcher Email",
    icon: "mark_email_unread",
    open: true,
    fields: [
      ["emailWatcherEnabled", "email_watcher_enabled", "Watcher Email", "true o false", "off", "text", "Abilita o disabilita il controllo automatico delle nuove email in arrivo."],
      ["emailWatcherImapHost", "email_watcher_imap_host", "IMAP Host", "imap.gmail.com", "off", "text", "Server IMAP della casella che Astebook deve ascoltare per trovare nuove email."],
      ["emailWatcherImapPort", "email_watcher_imap_port", "IMAP Port", "993", "off", "text", "Porta IMAP della casella ascoltata. Di solito 993 quando IMAP Secure è true."],
      ["emailWatcherImapSecure", "email_watcher_imap_secure", "IMAP Secure", "true", "off", "text", "Imposta true quando la connessione IMAP deve usare SSL/TLS."],
      [
        "emailWatcherFromAllowlist",
        "email_watcher_from_allowlist",
        "Mittenti autorizzati",
        "email@dominio.it, altra@dominio.it",
        "off",
        "text",
        "Quando arriverà una mail da un utente presente in questa lista la pipeline si attiverà.",
      ],
      ["emailWatcherRequiredFilename", "email_watcher_required_filename", "File richiesto", "proposta", "off", "text", "La pipeline prosegue solo se tra gli allegati c'è un file il cui nome contiene questo testo."],
      ["emailWatcherPollSeconds", "email_watcher_poll_seconds", "Polling watcher sec", "120", "off", "text", "Ogni quanti secondi il watcher controlla la casella IMAP per nuove email."],
    ],
  },
  {
    title: "Documenti e Invio",
    icon: "description",
    open: true,
    fields: [
      ["documentTemplateUrl", "document_template_url", "Template Documento", "Link Google Doc template con placeholder {{campo}}", "off", "text", "Link del template documento usato per generare l'output con i dati estratti."],
      ["documentSendTo", "document_send_to", "Send to", "email@dominio.it, altra@dominio.it", "off", "text", "Lista destinatari che riceveranno i documenti o le notifiche finali della pipeline."],
    ],
  },
  {
    title: "API AI e OCR",
    icon: "psychology",
    open: true,
    fields: [
      ["aiApiKey", "ai_api_key", "AI API Key", "Chiave API OpenRouter/OpenAI", "off", "password", "Chiave API usata dagli agenti AI per estrarre e normalizzare i dati."],
      ["aiBaseUrl", "ai_base_url", "AI Base URL", "https://openrouter.ai/api/v1", "off", "text", "Endpoint compatibile OpenAI/OpenRouter a cui Astebook invia le richieste AI."],
      ["aiModel", "ai_model", "AI Model", "openai/gpt-4o-mini", "off", "text", "Modello AI usato per l'estrazione dei dati dai testi e dai documenti."],
      ["pdfAppApiKey", "pdf_app_api_key", "PDF-app API Key", "API key PDF-app.net", "off", "password", "Chiave API usata per inviare PDF e immagini al servizio OCR."],
      ["pdfAppOcrEndpoint", "pdf_app_ocr_endpoint", "PDF-app OCR Endpoint", "Endpoint OCR 2.0 PDF-app.net", "off", "text", "Endpoint usato per avviare l'OCR sui documenti ricevuti."],
      ["pdfAppJobEndpoint", "pdf_app_job_endpoint", "PDF-app Job Endpoint", "Endpoint polling job async, opzionale", "off", "text", "Endpoint opzionale usato per controllare lo stato dei job OCR asincroni."],
    ],
  },
  {
    title: "Sicurezza e Utenti",
    icon: "admin_panel_settings",
    open: true,
    fields: [
      ["processingUiToken", "processing_ui_token", "Token UI", "Token per le API della UI", "off", "password", "Token usato dalla console admin per chiamare le API protette della pipeline."],
      ["zapierWebhookToken", "zapier_webhook_token", "Token Webhook Zapier", "Token richiesto dagli hook Zapier", "off", "password", "Token richiesto dai vecchi webhook Zapier. Serve solo se il webhook Zapier resta attivo."],
      ["adminSessionSecret", "admin_session_secret", "Session Secret", "Secret per firmare la sessione admin", "off", "password", "Secret usato dal server per firmare le sessioni dell'area admin."],
      ["adminPassword", "admin_password", "Nuova Password Admin", "Lascia vuoto per non cambiarla", "new-password", "password", "Imposta una nuova password admin. Se resta vuoto, la password attuale non cambia."],
    ],
  },
];

export default function ConsoleAdmin() {
  const renderField = ([id, name, label, placeholder, autocomplete, inputType, helpText]) => (
    <div className="settings-field" key={id}>
      <div className="settings-label-row">
        <label htmlFor={id}>{label}</label>
        {helpText ? (
          <span className="settings-info" tabIndex="0" role="img" aria-label={helpText} title={helpText} data-tooltip={helpText}>
            <span className="material-symbols-outlined" aria-hidden="true">info</span>
          </span>
        ) : null}
      </div>
      <div className={inputType === "password" ? "secret-field" : "plain-field"}>
        <input id={id} name={name} type={inputType} autoComplete={autocomplete} placeholder={placeholder} />
        {inputType === "password" ? (
          <button className="icon-button reveal-button" type="button" data-reveal={id} title="Mostra">
            <span className="material-symbols-outlined" aria-hidden="true">visibility</span>
          </button>
        ) : null}
      </div>
    </div>
  );

  return (
    <main id="settingsPage" className="settings-page" hidden>
      <header className="settings-page-header">
        <div>
          <p className="eyebrow">Console Admin</p>
          <h1 id="settingsTitle">Impostazioni</h1>
        </div>
        <div className="settings-page-actions">
          <p id="settingsStatus" className="settings-status"></p>
          <button id="closeSettingsButton" className="secondary-button" type="button">
            <span className="material-symbols-outlined" aria-hidden="true">arrow_back</span>
            Dashboard
          </button>
          <button type="submit" form="settingsForm" className="primary-button">Salva</button>
        </div>
      </header>
      <div className="settings-page-content">
        <form id="settingsForm" className="settings-form settings-form-page">
          <div className="settings-sections">
            {settingsSections.map((section) => (
              <details className="settings-section" key={section.title} open={section.open}>
                <summary>
                  <span className="material-symbols-outlined" aria-hidden="true">{section.icon}</span>
                  <span>{section.title}</span>
                </summary>
                <div className="settings-section-grid">
                  {section.fields.map(renderField)}
                </div>
              </details>
            ))}
          </div>
        </form>
        <aside className="settings-side-panel">
          <section className="settings-summary settings-summary-page">
            <div>
              <p className="eyebrow">Runtime</p>
              <h2>Valori salvati</h2>
            </div>
            <div id="settingsPane" className="settings-cards"></div>
          </section>
          <section className="settings-summary learning-summary">
            <div className="settings-panel-header">
              <div>
                <p className="eyebrow">Memoria</p>
                <h2>Autoapprendimento AI</h2>
              </div>
              <button id="refreshLearningButton" className="icon-button" type="button" title="Aggiorna memoria AI">
                <span className="material-symbols-outlined" aria-hidden="true">refresh</span>
              </button>
            </div>
            <div id="learningPane" className="learning-pane"></div>
          </section>
        </aside>
      </div>
    </main>
  );
}
