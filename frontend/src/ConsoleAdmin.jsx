const settingsSections = [
  {
    id: "smtp",
    title: "SMTP",
    tag: "Email in uscita",
    icon: "outgoing_mail",
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
    id: "watcher-email",
    title: "Watcher Email",
    tag: "Email in ingresso",
    icon: "mark_email_unread",
    panel: "watcher",
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
    id: "documenti-invio",
    title: "Documenti e Invio",
    tag: "Output pipeline",
    icon: "description",
    panel: "documents",
    fields: [
      ["documentTemplateUrl", "document_template_url", "Template Documento", "Link Google Doc template con placeholder {{campo}}", "off", "text", "Link del template documento usato per generare l'output con i dati estratti."],
      ["documentSendTo", "document_send_to", "Send to", "email@dominio.it, altra@dominio.it", "off", "text", "Lista destinatari che riceveranno i documenti o le notifiche finali della pipeline."],
    ],
  },
  {
    id: "api-ai-ocr",
    title: "API AI e OCR",
    tag: "Estrazione dati",
    icon: "psychology",
    panel: "analysis",
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
    id: "sicurezza-utenti",
    title: "Sicurezza e Utenti",
    tag: "Accessi e token",
    icon: "admin_panel_settings",
    fields: [
      ["processingUiToken", "processing_ui_token", "Token UI", "Token per le API della UI", "off", "password", "Token usato dalla console admin per chiamare le API protette della pipeline."],
      ["zapierWebhookToken", "zapier_webhook_token", "Token Webhook Zapier", "Token richiesto dagli hook Zapier", "off", "password", "Token richiesto dai vecchi webhook Zapier. Serve solo se il webhook Zapier resta attivo."],
      ["adminSessionSecret", "admin_session_secret", "Session Secret", "Secret per firmare la sessione admin", "off", "password", "Secret usato dal server per firmare le sessioni dell'area admin."],
      ["adminPassword", "admin_password", "Nuova Password Admin", "Lascia vuoto per non cambiarla", "new-password", "password", "Imposta una nuova password admin. Se resta vuoto, la password attuale non cambia."],
    ],
  },
  {
    id: "memoria-ai",
    title: "Memoria AI",
    tag: "Autoapprendimento",
    icon: "neurology",
    fields: [
      ["aiMemoryEnabled", "ai_memory_enabled", "Memoria AI", "true o false", "off", "text", "Abilita o disabilita l'uso delle correzioni validate nei prompt futuri."],
      ["aiMemoryExamplesLimit", "ai_memory_examples_limit", "Esempi nei prompt", "8", "off", "text", "Numero massimo di correzioni recenti da passare all'AI per ogni estrazione."],
    ],
    panel: "learning",
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
          <div className="settings-view-shell">
            <nav className="settings-view-nav" aria-label="Sezioni impostazioni">
              <div className="settings-view-search">
                <span className="material-symbols-outlined" aria-hidden="true">search</span>
                <input id="settingsSectionSearch" type="search" placeholder="Cerca sezione" autoComplete="off" />
              </div>
              <div className="settings-view-list">
                {settingsSections.map((section, index) => (
                  <button
                    className={`settings-view-tab ${index === 0 ? "active" : ""}`}
                    type="button"
                    data-settings-tab={section.id}
                    key={section.id}
                    aria-controls={`settings-section-${section.id}`}
                    aria-selected={index === 0 ? "true" : "false"}
                  >
                    <span className="material-symbols-outlined" aria-hidden="true">{section.icon}</span>
                    <span>
                      <strong>{section.title}</strong>
                      <small>{section.tag}</small>
                    </span>
                  </button>
                ))}
              </div>
            </nav>
            <div className="settings-view-content">
              {settingsSections.map((section, index) => (
                <section
                  id={`settings-section-${section.id}`}
                  className="settings-section"
                  data-settings-section={section.id}
                  key={section.id}
                  hidden={index !== 0}
                >
                  <header className="settings-section-header">
                    <div>
                      <p className="eyebrow">{section.tag}</p>
                      <h2>{section.title}</h2>
                    </div>
                    <span className="material-symbols-outlined" aria-hidden="true">{section.icon}</span>
                  </header>
                  <div className="settings-section-grid">
                    {section.fields.map(renderField)}
                  </div>
                  {section.panel === "documents" ? (
                    <div className="settings-section-panel">
                      <div className="settings-panel-header">
                        <div>
                          <p className="eyebrow">Azione manuale</p>
                          <h3>Invio ultimo documento</h3>
                        </div>
                        <button id="manualSendLatestDocumentButton" className="secondary-button" type="button">
                          <span className="material-symbols-outlined" aria-hidden="true">outgoing_mail</span>
                          Invia ultimo documento
                        </button>
                      </div>
                      <p id="manualSendLatestDocumentStatus" className="settings-help-text">
                        Invia via email l'ultimo evento con documento generabile e dati merged disponibili.
                      </p>
                    </div>
                  ) : null}
                  {section.panel === "analysis" ? (
                    <div className="settings-section-panel">
                      <div className="settings-panel-header">
                        <div>
                          <p className="eyebrow">Azione manuale</p>
                          <h3>OCR e Analisi AI ultima mail</h3>
                        </div>
                        <button id="manualAnalyzeLatestEmailButton" className="secondary-button" type="button">
                          <span className="material-symbols-outlined" aria-hidden="true">document_scanner</span>
                          Analizza ultima mail
                        </button>
                      </div>
                      <p id="manualAnalyzeLatestEmailStatus" className="settings-help-text">
                        Rielabora l'ultima email ricevuta con OCR e AI senza inviare automaticamente il documento.
                      </p>
                    </div>
                  ) : null}
                  {section.panel === "watcher" ? (
                    <div className="settings-section-panel">
                      <div className="settings-panel-header">
                        <div>
                          <p className="eyebrow">Azione manuale</p>
                          <h3>Scansione watcher</h3>
                        </div>
                        <button id="manualWatcherScanButton" className="secondary-button" type="button">
                          <span className="material-symbols-outlined" aria-hidden="true">play_arrow</span>
                          Scansiona ora
                        </button>
                      </div>
                      <p id="manualWatcherScanStatus" className="settings-help-text">
                        Avvia subito un controllo IMAP usando i filtri configurati sopra.
                      </p>
                    </div>
                  ) : null}
                  {section.panel === "learning" ? (
                    <div className="settings-section-panel">
                      <div className="settings-panel-header">
                        <div>
                          <p className="eyebrow">Memoria validata</p>
                          <h3>Autoapprendimento AI</h3>
                        </div>
                        <button id="refreshLearningButton" className="icon-button" type="button" title="Aggiorna memoria AI">
                          <span className="material-symbols-outlined" aria-hidden="true">refresh</span>
                        </button>
                      </div>
                      <div id="learningPane" className="learning-pane"></div>
                    </div>
                  ) : null}
                </section>
              ))}
            </div>
          </div>
        </form>
      </div>
    </main>
  );
}
