import { useEffect } from "react";
import "./styles.css";

const adminMarkup = String.raw`
  <main class="shell">
    <aside class="sidebar">
      <div class="brand">
        <span>Astebook</span>
        <div class="toolbar">
          <button id="refreshButton" class="icon-button" type="button" title="Aggiorna">
            <span class="material-symbols-outlined" aria-hidden="true">refresh</span>
          </button>
          <button id="settingsButton" class="icon-button" type="button" title="Impostazioni">
            <span class="material-symbols-outlined" aria-hidden="true">settings</span>
          </button>
          <button id="notificationsButton" class="icon-button notification-button" type="button" title="Lavorazioni bloccate">
            <span class="material-symbols-outlined" aria-hidden="true">notifications</span>
            <span id="notificationsCount" class="notification-count" hidden>0</span>
          </button>
          <form method="post" action="/admin/logout">
            <button class="icon-button" type="submit" title="Esci">
              <span class="material-symbols-outlined" aria-hidden="true">logout</span>
            </button>
          </form>
        </div>
      </div>
      <div class="search-bar">
        <label class="search-field" for="eventSearchInput">
          <span class="material-symbols-outlined" aria-hidden="true">search</span>
          <input id="eventSearchInput" type="search" placeholder="Cerca procedura, proponente, email..." />
        </label>
        <button id="filtersButton" class="icon-button" type="button" title="Filtri">
          <span class="material-symbols-outlined" aria-hidden="true">filter_list</span>
        </button>
      </div>
      <div id="eventList" class="event-list"></div>
    </aside>

    <section class="detail">
      <header class="detail-header">
        <div>
          <p id="selectedSource" class="eyebrow">Nessun evento</p>
          <h1 id="selectedTitle">Seleziona una lavorazione</h1>
        </div>
        <div class="detail-actions">
          <button id="reprocessButton" class="secondary-button" type="button" disabled>
            <span class="material-symbols-outlined" aria-hidden="true">sync</span>
            Riprocessa
          </button>
          <button id="documentButton" class="secondary-button" type="button" disabled>
            <span class="material-symbols-outlined" aria-hidden="true">description</span>
            Visualizza documento
          </button>
          <span id="selectedStatus" class="status">-</span>
        </div>
      </header>

      <section class="summary-grid">
        <div><span>Ricevuto</span><strong id="receivedAt">-</strong></div>
        <div><span>Aggiornato</span><strong id="updatedAt">-</strong></div>
        <div><span>File</span><strong id="fileCount">-</strong></div>
      </section>

      <section class="panes">
        ${[
          ["mail", "Mail e Payload", "requestPane", "data-view"],
          ["timeline", "Log Elaborazione", "stepsPane", "steps"],
          ["attach_file", "File Elaborati", "filesPane", "data-view"],
          ["fact_check", "Dati Estratti", "resultPane", "data-view"],
          ["sticky_note_2", "Notes", "notesPane", "data-view"],
          ["rule", "Missing Fields", "missingFieldsPane", "data-view"],
          ["error", "Errori Pipeline", "errorPane", "data-view"],
        ]
          .map(
            ([icon, title, id, className], index) => `
          <article class="panel${index === 0 ? " panel-wide" : ""} collapsible-panel">
            <button class="panel-toggle" type="button" aria-expanded="true">
              <span class="material-symbols-outlined" aria-hidden="true">${icon}</span>
              ${title}
              <span class="material-symbols-outlined panel-chevron" aria-hidden="true">expand_less</span>
            </button>
            <div class="panel-body">
              <div id="${id}" class="${className}"></div>
            </div>
          </article>`
          )
          .join("")}
      </section>
    </section>
  </main>

  <div id="notificationsModal" class="modal-backdrop" hidden>
    <section class="modal modal-narrow" role="dialog" aria-modal="true" aria-labelledby="notificationsTitle">
      <header class="modal-header">
        <div><p class="eyebrow">Lavorazioni bloccate</p><h2 id="notificationsTitle">Notifiche</h2></div>
        <button id="closeNotificationsButton" class="icon-button" type="button" title="Chiudi">
          <span class="material-symbols-outlined" aria-hidden="true">close</span>
        </button>
      </header>
      <div id="notificationsPane" class="notifications-list"></div>
    </section>
  </div>

  <div id="filtersModal" class="modal-backdrop" hidden>
    <section class="modal modal-narrow" role="dialog" aria-modal="true" aria-labelledby="filtersTitle">
      <header class="modal-header">
        <div><p class="eyebrow">Ricerca lavorazioni</p><h2 id="filtersTitle">Filtri</h2></div>
        <button id="closeFiltersButton" class="icon-button" type="button" title="Chiudi">
          <span class="material-symbols-outlined" aria-hidden="true">close</span>
        </button>
      </header>
      <form id="filtersForm" class="filters-form">
        <label><span>Stato</span><select id="filterStatus" name="status"><option value="">Tutti</option><option value="received">Ricevuto</option><option value="processing">In lavorazione</option><option value="extracting">Estrazione</option><option value="completed">Completato</option><option value="failed">Errore</option></select></label>
        <label><span>Procedura / Codice pratica</span><input id="filterProcedure" name="procedure" type="text" placeholder="RM_Roma_TOL_..." /></label>
        <label><span>Proponente</span><input id="filterProponente" name="proponente" type="text" placeholder="Nome proponente" /></label>
        <label><span>Azienda</span><input id="filterAzienda" name="azienda" type="text" placeholder="Azienda o procedura" /></label>
        <label><span>Email</span><input id="filterEmail" name="email" type="text" placeholder="mittente o dominio" /></label>
        <div class="filters-grid"><label><span>Ricevuto da</span><input id="filterDateFrom" name="date_from" type="date" /></label><label><span>Ricevuto a</span><input id="filterDateTo" name="date_to" type="date" /></label></div>
        <div class="filters-grid"><label><span>Errori</span><select id="filterHasError" name="has_error"><option value="">Tutti</option><option value="yes">Solo con errori</option><option value="no">Solo senza errori</option></select></label><label><span>File</span><select id="filterHasFiles" name="has_files"><option value="">Tutti</option><option value="yes">Solo con file</option><option value="no">Solo senza file</option></select></label></div>
        <div class="modal-actions"><button id="resetFiltersButton" class="secondary-button" type="button"><span class="material-symbols-outlined" aria-hidden="true">restart_alt</span>Reset</button><button class="primary-button" type="submit">Applica</button></div>
      </form>
    </section>
  </div>

  <div id="settingsModal" class="modal-backdrop" hidden>
    <section class="modal" role="dialog" aria-modal="true" aria-labelledby="settingsTitle">
      <header class="modal-header">
        <div><p class="eyebrow">Console Admin</p><h2 id="settingsTitle">Impostazioni</h2></div>
        <button id="closeSettingsButton" class="icon-button" type="button" title="Chiudi"><span class="material-symbols-outlined" aria-hidden="true">close</span></button>
      </header>
      <form id="settingsForm" class="settings-form">
        ${[
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
          ["adminPassword", "admin_password", "Nuova Password Admin", "Lascia vuoto per non cambiarla", "new-password"],
        ]
          .map(
            ([id, name, label, placeholder, autocomplete]) => `
        <label>
          <span>${label}</span>
          <div class="secret-field">
            <input id="${id}" name="${name}" type="password" autocomplete="${autocomplete}" placeholder="${placeholder}" />
            <button class="icon-button reveal-button" type="button" data-reveal="${id}" title="Mostra">
              <span class="material-symbols-outlined" aria-hidden="true">visibility</span>
            </button>
          </div>
        </label>`
          )
          .join("")}
        <div class="modal-actions"><p id="settingsStatus" class="settings-status"></p><button type="submit" class="primary-button">Salva</button></div>
      </form>
      <section class="settings-summary"><h3>Valori salvati</h3><div id="settingsPane" class="settings-cards"></div></section>
    </section>
  </div>
`;

export default function App() {
  useEffect(() => {
    import("./adminClient.js");
  }, []);

  return <div dangerouslySetInnerHTML={{ __html: adminMarkup }} />;
}
