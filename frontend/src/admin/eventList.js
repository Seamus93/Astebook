import { apiFetch } from "./apiClient.js";
import { formatEventTimestamp } from "./dateFormat.js";
import { showToast } from "./toast.js";

function mailboxState(message) {
  if (message.event_id) {
    return {
      key: "processed",
      label: message.seen ? "Letta e processata" : "Processata",
      tone: "done",
      issue: null,
    };
  }
  if (message.before_baseline) {
    return {
      key: "before-baseline",
      label: "Vecchia ignorata",
      tone: "done",
      issue: null,
    };
  }
  if (message.sender_allowed === false) {
    return {
      key: "skipped-sender",
      label: "Mittente escluso",
      tone: "bad",
      issue: `Mittente non autorizzato: ${(message.from || []).join(", ") || "-"}.`,
    };
  }
  if (!message.required_filename_match) {
    return {
      key: "skipped-file",
      label: "Scartata",
      tone: "bad",
      issue: `File richiesto non trovato: ${message.required_filename || "proposta"}.`,
    };
  }
  if (message.processed) {
    return {
      key: "state-only",
      label: "State senza evento",
      tone: "bad",
      issue: "La mail risulta nello state, ma non esiste un evento collegato. Puoi processarla manualmente.",
    };
  }
  if (message.seen) {
    if (message.sender_allowed !== false && message.required_filename_match === true) {
      return {
        key: "seen-processable",
        label: "Letta processabile",
        tone: "warn",
        issue: "La mail e letta: il watcher automatico la ignora, ma puoi processarla manualmente.",
      };
    }
    return {
      key: "seen-unprocessed",
      label: "Letta non processata",
      tone: "warn",
      issue: "La mail e letta: il watcher automatico la ignora finche non viene marcata non letta.",
    };
  }
  return {
    key: "unseen-unprocessed",
    label: "Da processare",
    tone: "warn",
    issue: "La mail e non letta e valida: avvia una scansione watcher.",
  };
}

export function createEventListController({ selectEvent, selectMailboxMessage }) {
  let allEvents = [];
  let mailboxMessages = [];
  let notificationItems = [];
  let initialMailboxSyncStarted = false;
  let mailboxPage = 1;
  let searchQuery = "";
  const mailboxPageSize = 7;
  const selectedEventIds = new Set();
  const selectedMailboxIds = new Set();

  function normalizedText(value) {
    return String(value ?? "")
      .toLowerCase()
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "");
  }

  function compactSearchText(value) {
    try {
      return normalizedText(JSON.stringify(value || {}));
    } catch {
      return normalizedText(value);
    }
  }

  function eventSearchText(event) {
    return compactSearchText([
      event.id,
      event.source,
      event.status,
      event.metadata,
      event.search,
      event.error_summary,
      event.workflow_issue,
    ]);
  }

  function mailboxSearchText(message) {
    const linkedEvent = message.event_id ? allEvents.find((event) => event.id === message.event_id) : null;
    return compactSearchText([
      message.id,
      message.uid,
      message.subject,
      message.from,
      message.to,
      message.filenames,
      message.sender_candidates,
      message.interceptor,
      linkedEvent?.metadata,
      linkedEvent?.search,
      linkedEvent?.error_summary,
    ]);
  }

  function matchesSearch(text) {
    const query = normalizedText(searchQuery).trim();
    if (!query) return true;
    return text.includes(query);
  }

  function filteredMailboxMessages() {
    return mailboxMessages.filter((message) => matchesSearch(mailboxSearchText(message)));
  }

  function filteredEvents() {
    return allEvents.filter((event) => matchesSearch(eventSearchText(event)));
  }

  function visibleEvents() {
    const mailboxEventIds = new Set(filteredMailboxMessages().map((message) => message.event_id).filter(Boolean));
    return filteredEvents().filter((event) => !mailboxEventIds.has(event.id));
  }

  function mailboxSelectionKey(message) {
    return `${message.mailbox || "INBOX"}:${message.uid || message.id || message.message_id || ""}`;
  }

  function visibleMailboxMessages() {
    const messages = filteredMailboxMessages();
    const pageCount = Math.max(1, Math.ceil(messages.length / mailboxPageSize));
    mailboxPage = Math.min(Math.max(1, mailboxPage), pageCount);
    const start = (mailboxPage - 1) * mailboxPageSize;
    return messages.slice(start, start + mailboxPageSize);
  }

  function pruneSelections() {
    const eventIds = new Set(allEvents.map((event) => event.id));
    selectedEventIds.forEach((id) => {
      if (!eventIds.has(id)) selectedEventIds.delete(id);
    });

    const mailboxIds = new Set(filteredMailboxMessages().map((message) => mailboxSelectionKey(message)));
    selectedMailboxIds.forEach((id) => {
      if (!mailboxIds.has(id)) selectedMailboxIds.delete(id);
    });
  }

  async function fetchMailboxMessages() {
    const resp = await apiFetch("/api/v1/admin/mailbox/messages?limit=30");
    const payload = await resp.json().catch(() => ({}));
    if (!resp.ok || payload.ok === false) {
      throw new Error(payload.error || payload.disabled_reason || `HTTP ${resp.status}`);
    }
    return payload;
  }

  async function syncMailboxIndex() {
    const resp = await apiFetch("/api/v1/admin/mailbox/sync", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ limit: 30, include_all_senders: false, days_back: 21 }),
    });
    const payload = await resp.json().catch(() => ({}));
    if (!resp.ok || payload.ok === false) {
      throw new Error(payload.error || payload.disabled_reason || `HTTP ${resp.status}`);
    }
    return payload;
  }

  async function refreshMailboxIndexFromCache(status = "") {
    try {
      const mailboxPayload = await fetchMailboxMessages();
      mailboxMessages = mailboxPayload.messages || [];
      renderEventList(status || (mailboxMessages.length ? `Mailbox indicizzata: ${mailboxMessages.length} email.` : ""));
      updateNotificationCenter();
    } catch (error) {
      console.warn("Mailbox index refresh failed", error);
    }
  }

  function wait(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  function startInitialMailboxSync() {
    if (initialMailboxSyncStarted) return;
    initialMailboxSyncStarted = true;
    syncMailboxIndex()
      .then(() => wait(3000))
      .then(fetchMailboxMessages)
      .then((freshPayload) => {
        mailboxMessages = freshPayload.messages || [];
        renderEventList(
          mailboxMessages.length
            ? `Mailbox indicizzata: ${mailboxMessages.length} email.`
            : "Sync mailbox completato. Indice ancora vuoto."
        );
        updateNotificationCenter();
      })
      .catch((syncError) => {
        console.warn("Initial mailbox sync failed", syncError);
        renderEventList(
          mailboxMessages.length
            ? `Mailbox indicizzata: ${mailboxMessages.length} email. Import storico non completato.`
            : `Indice mailbox vuoto. Import storico non avviato: ${syncError.message || String(syncError)}.`
        );
        updateNotificationCenter();
      });
  }

  async function loadEvents() {
    try {
      renderEventList("Mailbox DB: caricamento in corso...");
      const eventsResp = await apiFetch("/api/v1/processing-events");
      if (!eventsResp.ok) {
        console.warn("Failed to load events", eventsResp.status);
        return;
      }
      const data = await eventsResp.json();
      allEvents = data.events || [];
      renderEventList("Mailbox DB: caricamento in corso...");
      updateNotificationCenter();
      if (allEvents.length) selectEvent(allEvents[0].id);

      let mailboxPayload = null;
      try {
        mailboxPayload = await fetchMailboxMessages();
      } catch (mailboxError) {
        console.warn("Failed to load mailbox messages", mailboxError);
        mailboxMessages = [];
        renderEventList(`Indice mailbox non disponibile: ${mailboxError.message || String(mailboxError)}.`);
        updateNotificationCenter();
        return;
      }

      mailboxMessages = mailboxPayload.messages || [];
      const status = mailboxMessages.length
        ? `Mailbox indicizzata: ${mailboxMessages.length} email.`
        : "Indice mailbox vuoto. Avvio import storico IMAP in background...";
      renderEventList(status);
      updateNotificationCenter();
      if (!mailboxMessages.length) startInitialMailboxSync();
    } catch (err) {
      console.error("loadEvents", err);
    }
  }

  function startMailboxIndexPolling() {
    const intervalMs = 60_000;
    window.setInterval(() => {
      if (document.hidden) return;
      refreshMailboxIndexFromCache();
    }, intervalMs);
  }

  async function scanWatcherThenReload() {
    const refreshButton = document.getElementById("refreshButton");
    if (refreshButton) refreshButton.disabled = true;
    try {
      const resp = await apiFetch("/api/v1/admin/email-watcher/scan", { method: "POST" });
      const payload = await resp.json().catch(() => ({}));
      if (payload.busy) {
        showToast({
          title: "Scansione gia in corso",
          message: "Il watcher sta gia controllando la mailbox. Aggiorno la UI con gli ultimi dati disponibili.",
          tone: "info",
        });
      } else if (!resp.ok || payload.ok === false) {
        showToast({
          title: "Scansione watcher non completata",
          message: payload.error || `HTTP ${resp.status}`,
          tone: "error",
        });
      } else {
        showToast({
          title: "Watcher aggiornato",
          message: `Processate ${payload.accepted || 0} email. Duplicate ${payload.duplicates || 0}.`,
          tone: "info",
        });
      }
    } catch (error) {
      showToast({
        title: "Scansione watcher non riuscita",
        message: error.message || String(error),
        tone: "error",
      });
    } finally {
      await wait(3000);
      await loadEvents();
      if (refreshButton) refreshButton.disabled = false;
    }
  }

  async function forgetMailboxMessageState(message) {
    try {
      const resp = await apiFetch("/api/v1/admin/email-watcher/state/forget", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ message_id: message.id }),
      });
      const payload = await resp.json().catch(() => ({}));
      if (!resp.ok || payload.ok === false) {
        showToast({
          title: "State non modificato",
          message: payload.error || `HTTP ${resp.status}`,
          tone: "error",
        });
        return;
      }
      showToast({
        title: "State email cancellato",
        message: payload.removed
          ? "Questa email puo essere riprocessata se risulta non letta."
          : "Questa email non era presente nello state.",
        tone: "info",
      });
      await loadEvents();
    } catch (error) {
      showToast({
        title: "State non modificato",
        message: error.message || String(error),
        tone: "error",
      });
    }
  }

  async function deleteSelectedEvents() {
    const selectedEvents = allEvents.filter((event) => selectedEventIds.has(event.id));
    const selectedMailboxMessages = mailboxMessages.filter((message) =>
      selectedMailboxIds.has(mailboxSelectionKey(message))
    );
    const selectedCount = selectedEvents.length + selectedMailboxMessages.length;
    if (!selectedCount) return;
    if (!window.confirm(`Applicare l'eliminazione a ${selectedCount} elementi selezionati?`)) return;

    try {
      const eventResults = await Promise.all(
        selectedEvents.map((event) =>
          apiFetch(`/api/v1/processing-events/${event.id}`, { method: "DELETE" })
        )
      );
      const mailboxResults = await Promise.all(
        selectedMailboxMessages.map((message) =>
          apiFetch("/api/v1/admin/email-watcher/state/forget", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ message_id: message.id }),
          })
        )
      );
      const failed = [...eventResults, ...mailboxResults].filter((resp) => !resp.ok).length;
      selectedEventIds.clear();
      selectedMailboxIds.clear();
      showToast({
        title: failed ? "Selezione aggiornata parzialmente" : "Selezione aggiornata",
        message: failed
          ? `${failed} elementi non sono stati aggiornati.`
          : `${selectedCount} elementi aggiornati nella lista.`,
        tone: failed ? "error" : "info",
      });
      await loadEvents();
    } catch (error) {
      showToast({
        title: "Lavorazioni non eliminate",
        message: error.message || String(error),
        tone: "error",
      });
    }
  }

  function syncSelectionControls() {
    const checkbox = document.getElementById("selectAllEventsCheckbox");
    const deleteButton = document.getElementById("deleteSelectedEventsButton");
    const selectedCount = selectedEventIds.size + selectedMailboxIds.size;
    const selectableEvents = visibleEvents();
    const selectableMailboxMessages = visibleMailboxMessages();
    const visibleSelectedCount =
      selectableEvents.filter((event) => selectedEventIds.has(event.id)).length +
      selectableMailboxMessages.filter((message) => selectedMailboxIds.has(mailboxSelectionKey(message))).length;
    const visibleSelectableCount = selectableEvents.length + selectableMailboxMessages.length;
    if (deleteButton) {
      deleteButton.hidden = selectedCount === 0;
      deleteButton.title = selectedCount ? `Elimina ${selectedCount} selezionate` : "Elimina selezionate";
    }
    if (checkbox) {
      checkbox.checked = visibleSelectableCount > 0 && visibleSelectedCount === visibleSelectableCount;
      checkbox.indeterminate = visibleSelectedCount > 0 && visibleSelectedCount < visibleSelectableCount;
    }
  }

  function toggleEventSelection(eventId, checked) {
    if (checked) selectedEventIds.add(eventId);
    else selectedEventIds.delete(eventId);
    renderEventList();
    syncSelectionControls();
  }

  function toggleMailboxSelection(message, checked) {
    const key = mailboxSelectionKey(message);
    if (checked) selectedMailboxIds.add(key);
    else selectedMailboxIds.delete(key);
    renderEventList();
    syncSelectionControls();
  }

  function renderEventItem(container, ev) {
    const title = ev.metadata?.subject || ev.metadata?.email_id || ev.metadata?.zap_run_id || ev.id;
    const row = document.createElement("div");
    row.className = "event-item event-item-row";
    row.dataset.eventId = ev.id;

    const selectWrap = document.createElement("label");
    selectWrap.className = "event-select";
    selectWrap.title = "Seleziona lavorazione";
    const selectInput = document.createElement("input");
    selectInput.type = "checkbox";
    selectInput.checked = selectedEventIds.has(ev.id);
    selectInput.addEventListener("click", (event) => event.stopPropagation());
    selectInput.addEventListener("change", () => toggleEventSelection(ev.id, selectInput.checked));
    selectWrap.appendChild(selectInput);

    const el = document.createElement("button");
    el.type = "button";
    el.className = "event-item-main";

    const titleEl = document.createElement("strong");
    titleEl.textContent = title;

    const timestampEl = document.createElement("span");
    timestampEl.textContent = formatEventTimestamp(ev.received_at || ev.updated_at);

    el.append(titleEl, timestampEl);
    el.addEventListener("click", () => selectEvent(ev.id));

    row.append(selectWrap, el);
    container.appendChild(row);
  }

  function renderMailboxItem(container, message) {
    const state = mailboxState(message);
    const row = document.createElement("div");
    row.className = `event-item mailbox-item mailbox-${state.tone}`;

    const selectWrap = document.createElement("label");
    selectWrap.className = "event-select mailbox-select";
    selectWrap.title = "Seleziona email";
    const selectInput = document.createElement("input");
    selectInput.type = "checkbox";
    selectInput.checked = selectedMailboxIds.has(mailboxSelectionKey(message));
    selectInput.addEventListener("click", (event) => event.stopPropagation());
    selectInput.addEventListener("change", () => toggleMailboxSelection(message, selectInput.checked));
    selectWrap.appendChild(selectInput);

    const button = document.createElement("button");
    button.type = "button";
    button.className = "mailbox-item-main";

    const titleEl = document.createElement("strong");
    titleEl.textContent = message.subject || "(senza oggetto)";

    const badge = document.createElement("em");
    badge.className = `mailbox-state-badge ${state.tone}`;
    badge.textContent = state.label;

    const metaEl = document.createElement("span");
    const status = [
      message.seen ? "letta" : "non letta",
      message.processed ? "state" : "no state",
      message.event_id ? "evento" : "no evento",
      message.before_baseline ? "prima baseline" : "dopo baseline",
      message.sender_allowed === false ? "mittente escluso" : "mittente ok",
    ].join(" · ");
    metaEl.textContent = `Mailbox ${formatEventTimestamp(message.date)} · ${status}`;

    button.append(titleEl, badge, metaEl);
    button.addEventListener("click", () => {
      if (message.event_id) {
        selectEvent(message.event_id);
        return;
      }
      selectMailboxMessage(message, loadEvents);
    });

    row.append(selectWrap, button);
    container.appendChild(row);
  }

  function renderMailboxPagination(container) {
    const pageCount = Math.ceil(filteredMailboxMessages().length / mailboxPageSize);
    if (pageCount <= 1) return;

    const nav = document.createElement("nav");
    nav.className = "mailbox-pagination";
    nav.setAttribute("aria-label", "Pagine email");

    const addPageButton = (page, label = String(page)) => {
      const button = document.createElement("button");
      button.type = "button";
      button.className = page === mailboxPage ? "active" : "";
      button.textContent = label;
      button.setAttribute("aria-label", `Pagina email ${page}`);
      button.addEventListener("click", () => {
        mailboxPage = page;
        renderEventList();
      });
      nav.appendChild(button);
    };

    const pages = new Set([1, pageCount, mailboxPage]);
    if (pageCount <= 5) {
      for (let page = 1; page <= pageCount; page += 1) pages.add(page);
    } else if (mailboxPage <= 3) {
      [2, 3].forEach((page) => pages.add(page));
    } else if (mailboxPage >= pageCount - 2) {
      [pageCount - 2, pageCount - 1].forEach((page) => pages.add(page));
    } else {
      [mailboxPage - 1, mailboxPage + 1].forEach((page) => pages.add(page));
    }

    let previousPage = 0;
    [...pages].sort((a, b) => a - b).forEach((page) => {
      if (page - previousPage > 1) {
        const ellipsis = document.createElement("span");
        ellipsis.textContent = "...";
        nav.appendChild(ellipsis);
      }
      addPageButton(page);
      previousPage = page;
    });

    if (mailboxPage < pageCount) {
      const next = document.createElement("button");
      next.type = "button";
      next.className = "mailbox-pagination-next";
      next.setAttribute("aria-label", "Pagina email successiva");
      next.innerHTML = '<span class="material-symbols-outlined" aria-hidden="true">chevron_right</span>';
      next.addEventListener("click", () => {
        mailboxPage = Math.min(pageCount, mailboxPage + 1);
        renderEventList();
      });
      nav.appendChild(next);
    }

    container.appendChild(nav);
  }

  function mailboxNotifications() {
    return mailboxMessages
      .map((message) => ({ message, state: mailboxState(message) }))
      .filter((item) => item.state.issue)
      .map(({ message, state }) => ({
      type: "mailbox",
        id: message.id,
        title: message.subject || "(senza oggetto)",
        badge: state.label,
        at: message.date,
        details: [
        state.issue,
        message.before_baseline ? `Baseline watcher: ${formatEventTimestamp(message.ignore_before)}` : "",
        `Mittente: ${(message.from || []).join(", ") || "-"}`,
        message.sender_allowed === false ? `Allowlist: ${(message.allowed_from || []).join(", ") || "vuota"}` : "",
        `Allegati: ${(message.filenames || []).join(", ") || "nessun allegato"}`,
        ],
        open: () => {
          if (message.event_id) {
            selectEvent(message.event_id);
          } else {
            selectMailboxMessage(message);
          }
        },
      }));
  }

  function eventNotifications() {
    return allEvents
      .filter((event) => event.workflow_issue || event.error_count > 0)
      .map((event) => ({
        type: "event",
        id: event.id,
        title: event.metadata?.subject || event.id,
        badge: event.workflow_issue?.step || "Errore",
        at: event.updated_at || event.received_at,
        details: [
          event.workflow_issue?.message || "Lavorazione con errori.",
          ...(event.error_summary || []).slice(0, 3),
        ],
        open: () => selectEvent(event.id),
      }));
  }

  function updateNotificationCenter() {
    notificationItems = [...mailboxNotifications(), ...eventNotifications()].sort((a, b) =>
      String(b.at || "").localeCompare(String(a.at || ""))
    );

    const count = document.getElementById("notificationsCount");
    if (count) {
      count.textContent = String(notificationItems.length);
      count.hidden = notificationItems.length === 0;
    }
  }

  function initNotifications() {
    const button = document.getElementById("notificationsButton");
    const modal = document.getElementById("notificationsModal");
    const closeButton = document.getElementById("closeNotificationsButton");
    const pane = document.getElementById("notificationsPane");
    if (!button || !modal || !closeButton || !pane) return;

    const renderNotifications = () => {
      pane.innerHTML = "";
      if (!notificationItems.length) {
        const empty = document.createElement("p");
        empty.className = "notification-empty";
        empty.textContent = "Nessuna mail o lavorazione richiede attenzione.";
        pane.appendChild(empty);
        return;
      }

      notificationItems.forEach((item) => {
        const entry = document.createElement("button");
        entry.type = "button";
        entry.className = `notification-item notification-${item.type}`;

        const header = document.createElement("div");
        header.className = "notification-item-header";
        const title = document.createElement("strong");
        title.textContent = item.title;
        const badge = document.createElement("span");
        badge.textContent = item.badge;
        header.append(title, badge);

        const list = document.createElement("ul");
        item.details.filter(Boolean).forEach((detail) => {
          const li = document.createElement("li");
          li.textContent = detail;
          list.appendChild(li);
        });

        entry.append(header, list);
        entry.addEventListener("click", () => {
          modal.hidden = true;
          item.open();
        });
        pane.appendChild(entry);
      });
    };

    button.addEventListener("click", () => {
      renderNotifications();
      modal.hidden = false;
    });
    closeButton.addEventListener("click", () => {
      modal.hidden = true;
    });
  }

  function renderMailboxStatus(container, message) {
    if (!message) return;
    if (/^Mailbox indicizzata:/i.test(message)) return;
    const el = document.createElement("div");
    el.className = "event-empty";
    el.textContent = message;
    container.appendChild(el);
  }

  function renderEventList(mailboxStatus = "") {
    const container = document.getElementById("eventList");
    if (!container) return;
    container.innerHTML = "";
    pruneSelections();
    visibleMailboxMessages().forEach((message) => renderMailboxItem(container, message));
    renderMailboxPagination(container);
    renderMailboxStatus(container, mailboxStatus);
    for (const ev of visibleEvents()) {
      renderEventItem(container, ev);
    }
    if (searchQuery.trim() && !filteredMailboxMessages().length && !visibleEvents().length) {
      renderMailboxStatus(container, "Nessun risultato per questa ricerca.");
    }
    syncSelectionControls();
  }

  function initSearchControls() {
    const input = document.getElementById("eventSearchInput");
    if (!input) return;
    input.addEventListener("input", () => {
      searchQuery = input.value || "";
      mailboxPage = 1;
      selectedEventIds.clear();
      selectedMailboxIds.clear();
      renderEventList();
    });
  }

  function initSelectionControls() {
    const checkbox = document.getElementById("selectAllEventsCheckbox");
    const deleteButton = document.getElementById("deleteSelectedEventsButton");
    if (checkbox) {
      checkbox.addEventListener("change", () => {
        selectedEventIds.clear();
        selectedMailboxIds.clear();
        if (checkbox.checked) {
          visibleEvents().forEach((event) => selectedEventIds.add(event.id));
          visibleMailboxMessages().forEach((message) => selectedMailboxIds.add(mailboxSelectionKey(message)));
        }
        renderEventList();
      });
    }
    if (deleteButton) {
      deleteButton.addEventListener("click", deleteSelectedEvents);
    }
  }

  return {
    initNotifications,
    initSearchControls,
    initSelectionControls,
    loadEvents,
    renderEventList,
    scanWatcherThenReload,
    startMailboxIndexPolling,
  };
}
