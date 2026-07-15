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
      issue: "La mail risulta nello state, ma non esiste un evento collegato.",
    };
  }
  if (message.seen) {
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
  const selectedEventIds = new Set();

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
      body: JSON.stringify({ limit: 30, include_all_senders: false }),
    });
    const payload = await resp.json().catch(() => ({}));
    if (!resp.ok || payload.ok === false) {
      throw new Error(payload.error || payload.disabled_reason || `HTTP ${resp.status}`);
    }
    return payload;
  }

  function wait(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  async function loadEvents() {
    try {
      mailboxMessages = [];
      renderEventList("Mailbox IMAP: caricamento in corso...");
      const eventsResp = await apiFetch("/api/v1/processing-events");
      if (!eventsResp.ok) {
        console.warn("Failed to load events", eventsResp.status);
        return;
      }
      const data = await eventsResp.json();
      allEvents = data.events || [];
      renderEventList("Mailbox IMAP: caricamento in corso...");
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
        : "Indice mailbox vuoto. Avvio sync IMAP in background...";
      renderEventList(status);
      updateNotificationCenter();

      syncMailboxIndex()
        .then(() => wait(3000))
        .then(fetchMailboxMessages)
        .then((freshPayload) => {
          mailboxMessages = freshPayload.messages || [];
          renderEventList(
            mailboxMessages.length
              ? `Mailbox indicizzata: ${mailboxMessages.length} email.`
              : "Sync mailbox avviato. Indice ancora vuoto."
          );
          updateNotificationCenter();
        })
        .catch((syncError) => {
          console.warn("Mailbox sync failed", syncError);
          renderEventList(
            mailboxMessages.length
              ? `Mailbox indicizzata: ${mailboxMessages.length} email. Sync non completata.`
              : `Indice mailbox vuoto. Sync non avviato: ${syncError.message || String(syncError)}.`
          );
          updateNotificationCenter();
        });
    } catch (err) {
      console.error("loadEvents", err);
    }
  }

  async function scanWatcherThenReload() {
    const refreshButton = document.getElementById("refreshButton");
    if (refreshButton) refreshButton.disabled = true;
    try {
      await syncMailboxIndex().catch((syncError) => {
        console.warn("Mailbox sync could not be started from refresh", syncError);
      });
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
    if (!selectedEvents.length) return;
    if (!window.confirm(`Eliminare ${selectedEvents.length} lavorazioni selezionate dalla lista?`)) return;

    try {
      const results = await Promise.all(
        selectedEvents.map((event) =>
          apiFetch(`/api/v1/processing-events/${event.id}`, { method: "DELETE" })
        )
      );
      const failed = results.filter((resp) => !resp.ok).length;
      selectedEventIds.clear();
      showToast({
        title: failed ? "Eliminazione parziale" : "Lavorazioni eliminate",
        message: failed
          ? `${failed} lavorazioni non sono state eliminate.`
          : `${selectedEvents.length} lavorazioni rimosse dal log Astebook.`,
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
    const selectedCount = selectedEventIds.size;
    if (deleteButton) {
      deleteButton.hidden = selectedCount === 0;
      deleteButton.title = selectedCount ? `Elimina ${selectedCount} selezionate` : "Elimina selezionate";
    }
    if (checkbox) {
      checkbox.checked = allEvents.length > 0 && selectedCount === allEvents.length;
      checkbox.indeterminate = selectedCount > 0 && selectedCount < allEvents.length;
    }
  }

  function toggleEventSelection(eventId, checked) {
    if (checked) selectedEventIds.add(eventId);
    else selectedEventIds.delete(eventId);
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

    const menu = document.createElement("button");
    menu.type = "button";
    menu.className = "mailbox-item-menu icon-button";
    menu.title = "Cancella state per questa email";
    menu.innerHTML = '<span class="material-symbols-outlined" aria-hidden="true">more_vert</span>';
    menu.addEventListener("click", (event) => {
      event.stopPropagation();
      forgetMailboxMessageState(message);
    });

    row.append(button, menu);
    container.appendChild(row);
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
    const el = document.createElement("div");
    el.className = "event-empty";
    el.textContent = message;
    container.appendChild(el);
  }

  function renderEventList(mailboxStatus = "") {
    const container = document.getElementById("eventList");
    if (!container) return;
    container.innerHTML = "";
    mailboxMessages.forEach((message) => renderMailboxItem(container, message));
    renderMailboxStatus(container, mailboxStatus);
    for (const ev of allEvents) {
      renderEventItem(container, ev);
    }
    syncSelectionControls();
  }

  function initSelectionControls() {
    const checkbox = document.getElementById("selectAllEventsCheckbox");
    const deleteButton = document.getElementById("deleteSelectedEventsButton");
    if (checkbox) {
      checkbox.addEventListener("change", () => {
        selectedEventIds.clear();
        if (checkbox.checked) {
          allEvents.forEach((event) => selectedEventIds.add(event.id));
        }
        renderEventList();
      });
    }
    if (deleteButton) {
      deleteButton.addEventListener("click", deleteSelectedEvents);
    }
  }

  return { initNotifications, initSelectionControls, loadEvents, renderEventList, scanWatcherThenReload };
}
