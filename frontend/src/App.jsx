import { useEffect } from "react";
import ConsoleAdmin from "./ConsoleAdmin.jsx";
import "./styles.css";

const adminMarkup = String.raw`
  <main id="appShell" class="shell">
    <aside class="sidebar">
      <div class="brand">
        <div class="brand-title">
          <span>Astebook</span>
          <button id="sidebarToggleButton" class="icon-button" type="button" title="Apri/chiudi elenco" aria-label="Apri o chiudi elenco" aria-expanded="true">
            <span class="material-symbols-outlined" aria-hidden="true">menu</span>
          </button>
        </div>
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
        <label class="selection-toggle" title="Seleziona tutte le lavorazioni">
          <input id="selectAllEventsCheckbox" type="checkbox" />
        </label>
        <label class="search-field" for="eventSearchInput">
          <span class="material-symbols-outlined" aria-hidden="true">search</span>
          <input id="eventSearchInput" type="search" placeholder="Cerca procedura, proponente, email..." />
        </label>
        <button id="deleteSelectedEventsButton" class="icon-button selection-delete-button" type="button" title="Elimina selezionate" hidden>
          <span class="material-symbols-outlined" aria-hidden="true">delete</span>
        </button>
        <button id="filtersButton" class="icon-button" type="button" title="Filtri">
          <span class="material-symbols-outlined" aria-hidden="true">filter_list</span>
        </button>
      </div>
      <div id="eventList" class="event-list"></div>
    </aside>

    <section class="detail">
      <div class="mobile-detail-bar">
        <button id="mobileBackButton" class="mobile-back-button" type="button">
          <span class="material-symbols-outlined" aria-hidden="true">chevron_left</span>
          Indietro
        </button>
        <button id="mobileActionsButton" class="mobile-actions-button" type="button" title="Azioni">
          <span class="material-symbols-outlined" aria-hidden="true">more_horiz</span>
        </button>
      </div>
      <header class="detail-header">
        <div class="detail-title">
          <button id="sidebarRestoreButton" class="icon-button sidebar-restore-button" type="button" title="Apri/chiudi elenco" aria-label="Apri o chiudi elenco" aria-expanded="true">
            <span class="material-symbols-outlined" aria-hidden="true">menu</span>
          </button>
          <div>
          <p id="selectedSource" class="eyebrow">Nessun evento</p>
          <h1 id="selectedTitle">Seleziona una lavorazione</h1>
          </div>
        </div>
        <div class="detail-actions">
          <button id="reprocessButton" class="icon-button" type="button" title="Riprocessa" aria-label="Riprocessa" disabled>
            <span class="material-symbols-outlined" aria-hidden="true">sync</span>
          </button>
          <button id="documentButton" class="icon-button" type="button" title="Visualizza documento" aria-label="Visualizza documento" disabled>
            <span class="material-symbols-outlined" aria-hidden="true">description</span>
          </button>
          <button id="emailDocumentButton" class="icon-button" type="button" title="Invia email" aria-label="Invia email" disabled>
            <span class="material-symbols-outlined" aria-hidden="true">outgoing_mail</span>
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
          ["real_estate_agent", "Dati Immobiliari", "immobiliarePane", "data-view"],
          ["fact_check", "Dati Estratti", "resultPane", "data-view"],
          ["sticky_note_2", "Notes", "notesPane", "data-view"],
          ["rule", "Missing Fields", "missingFieldsPane", "data-view"],
          ["error", "Errori Pipeline", "errorPane", "data-view"],
        ]
          .map(
            ([icon, title, id, className], index) => `
          <article class="panel${index === 0 ? " panel-wide" : ""} collapsible-panel collapsed">
            <button class="panel-toggle" type="button" aria-expanded="false">
              <span class="material-symbols-outlined" aria-hidden="true">${icon}</span>
              ${title}
              <span class="material-symbols-outlined panel-chevron" aria-hidden="true">expand_more</span>
            </button>
            <div class="panel-body">
              <pre id="${id}" class="${className}"></pre>
            </div>
          </article>`
          )
          .join("")}
      </section>
    </section>

    <nav class="mobile-bottom-nav" aria-label="Navigazione mobile">
      <button class="mobile-nav-button mobile-nav-mailbox active" type="button">
        <span class="material-symbols-outlined" aria-hidden="true">mail</span>
        Mailbox
      </button>
      <button class="mobile-nav-button mobile-nav-detail" type="button">
        <span class="material-symbols-outlined" aria-hidden="true">description</span>
        Procedure
      </button>
      <button class="mobile-nav-primary" type="button" title="Processa">
        <span class="material-symbols-outlined" aria-hidden="true">add</span>
      </button>
      <button class="mobile-nav-button mobile-nav-events" type="button">
        <span class="material-symbols-outlined" aria-hidden="true">schedule</span>
        Eventi
      </button>
      <button class="mobile-nav-button mobile-nav-settings" type="button">
        <span class="material-symbols-outlined" aria-hidden="true">settings</span>
        Impostazioni
      </button>
    </nav>
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

`;

export default function App() {
  useEffect(() => {
    import("./adminClient.js");
  }, []);

  return (
    <>
      <div dangerouslySetInnerHTML={{ __html: adminMarkup }} />
      <ConsoleAdmin />
    </>
  );
}
