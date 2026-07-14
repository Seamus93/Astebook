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

  async function loadEvents() {
    try {
      const [eventsResp, mailboxResp] = await Promise.all([
        apiFetch("/api/v1/processing-events"),
        apiFetch("/api/v1/admin/email-watcher/messages?limit=100"),
      ]);
      if (!eventsResp.ok) {
        console.warn("Failed to load events", eventsResp.status);
        return;
      }
      const data = await eventsResp.json();
      allEvents = data.events || [];
      if (mailboxResp.ok) {
        const mailboxPayload = await mailboxResp.json();
        mailboxMessages = mailboxPayload.messages || [];
      } else {
        mailboxMessages = [];
      }
      renderEventList();
      updateNotificationCenter();
      if (allEvents.length) selectEvent(allEvents[0].id);
    } catch (err) {
      console.error("loadEvents", err);
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

  async function deleteEvent(eventId, title) {
    if (!window.confirm(`Eliminare questa lavorazione dalla lista?\n\n${title}`)) return;
    try {
      const resp = await apiFetch(`/api/v1/processing-events/${eventId}`, { method: "DELETE" });
      const payload = await resp.json().catch(() => ({}));
      if (!resp.ok || payload.ok === false) {
        showToast({
          title: "Lavorazione non eliminata",
          message: payload.error || `HTTP ${resp.status}`,
          tone: "error",
        });
        return;
      }
      showToast({
        title: "Lavorazione eliminata",
        message: "Il record e stato rimosso dal log Astebook.",
        tone: "info",
      });
      await loadEvents();
    } catch (error) {
      showToast({
        title: "Lavorazione non eliminata",
        message: error.message || String(error),
        tone: "error",
      });
    }
  }

  function renderEventItem(container, ev) {
    const title = ev.metadata?.subject || ev.metadata?.email_id || ev.metadata?.zap_run_id || ev.id;
    const row = document.createElement("div");
    row.className = "event-item event-item-row";
    row.dataset.eventId = ev.id;

    const el = document.createElement("button");
    el.type = "button";
    el.className = "event-item-main";

    const titleEl = document.createElement("strong");
    titleEl.textContent = title;

    const timestampEl = document.createElement("span");
    timestampEl.textContent = formatEventTimestamp(ev.received_at || ev.updated_at);

    el.append(titleEl, timestampEl);
    el.addEventListener("click", () => selectEvent(ev.id));

    const deleteButton = document.createElement("button");
    deleteButton.type = "button";
    deleteButton.className = "event-item-menu icon-button";
    deleteButton.title = "Elimina lavorazione";
    deleteButton.innerHTML = '<span class="material-symbols-outlined" aria-hidden="true">delete</span>';
    deleteButton.addEventListener("click", (event) => {
      event.stopPropagation();
      deleteEvent(ev.id, title);
    });

    row.append(el, deleteButton);
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

  function renderEventList() {
    const container = document.getElementById("eventList");
    if (!container) return;
    container.innerHTML = "";
    mailboxMessages.forEach((message) => renderMailboxItem(container, message));
    for (const ev of allEvents) {
      renderEventItem(container, ev);
    }
  }

  return { initNotifications, loadEvents, renderEventList };
}
