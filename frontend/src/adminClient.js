import { createDetailController } from "./admin/detailController.js";
import { createEventListController } from "./admin/eventList.js";
import { createSettingsController } from "./admin/settingsController.js";
import { initSidebarToggle } from "./admin/shell.js";
import { qs } from "./admin/dom.js";

export default function initAdminClient() {
  const settings = createSettingsController();
  const details = createDetailController();
  const events = createEventListController({ selectEvent: details.selectEvent });

  document.getElementById("settingsButton").addEventListener("click", () => {
    qs("settingsModal").hidden = false;
  });
  document.getElementById("closeSettingsButton").addEventListener("click", () => {
    qs("settingsModal").hidden = true;
  });

  settings.initRevealButtons();
  initSidebarToggle();
  qs("settingsForm").addEventListener("submit", settings.saveSettings);

  const baseInput = qs("aiBaseUrl");
  if (baseInput) baseInput.addEventListener("input", settings.suggestModelBasedOnBaseUrl);

  settings.loadSettings();
  events.loadEvents();
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", initAdminClient);
} else {
  initAdminClient();
}
