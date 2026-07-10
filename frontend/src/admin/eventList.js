import { apiFetch } from "./apiClient.js";

export function createEventListController({ selectEvent }) {
  let allEvents = [];

  async function loadEvents() {
    try {
      const resp = await apiFetch("/api/v1/processing-events");
      if (!resp.ok) {
        console.warn("Failed to load events", resp.status);
        return;
      }
      const data = await resp.json();
      allEvents = data.events || [];
      renderEventList();
      if (allEvents.length) selectEvent(allEvents[0].id);
    } catch (err) {
      console.error("loadEvents", err);
    }
  }

  function renderEventList() {
    const container = document.getElementById("eventList");
    if (!container) return;
    container.innerHTML = "";
    for (const ev of allEvents) {
      const title = ev.metadata?.subject || ev.metadata?.email_id || ev.metadata?.zap_run_id || ev.id;
      const el = document.createElement("button");
      el.type = "button";
      el.className = "event-item";
      el.textContent = `${title} — ${ev.status || ""}`;
      el.dataset.eventId = ev.id;
      el.addEventListener("click", () => selectEvent(ev.id));
      container.appendChild(el);
    }
  }

  return { loadEvents, renderEventList };
}
