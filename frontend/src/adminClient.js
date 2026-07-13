import { createDetailController } from "./admin/detailController.js";
import { createEventListController } from "./admin/eventList.js";
import { createLearningController } from "./admin/learningController.js";
import { createSettingsController } from "./admin/settingsController.js";
import { initSidebarToggle } from "./admin/shell.js";
import { qs } from "./admin/dom.js";

export default function initAdminClient() {
  const learning = createLearningController();
  const settings = createSettingsController();
  const details = createDetailController();
  const events = createEventListController({ selectEvent: details.selectEvent });

  function renderRoute() {
    const onSettings = window.location.pathname.replace(/\/+$/, "") === "/admin/settings";
    const shell = qs("appShell");
    const settingsPage = qs("settingsPage");
    if (shell) shell.hidden = onSettings;
    if (settingsPage) settingsPage.hidden = !onSettings;
  }

  function navigate(path) {
    window.history.pushState({}, "", path);
    renderRoute();
  }

  document.getElementById("settingsButton").addEventListener("click", () => navigate("/admin/settings"));
  document.getElementById("closeSettingsButton").addEventListener("click", () => navigate("/admin/"));
  window.addEventListener("popstate", renderRoute);

  settings.initRevealButtons();
  settings.initSettingsSectionView();
  settings.initWatcherScanButton();
  learning.initLearningControls();
  initSidebarToggle();
  qs("settingsForm").addEventListener("submit", settings.saveSettings);

  const baseInput = qs("aiBaseUrl");
  if (baseInput) baseInput.addEventListener("input", settings.suggestModelBasedOnBaseUrl);

  settings.loadSettings();
  learning.loadLearningSummary();
  events.loadEvents();
  renderRoute();
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", initAdminClient);
} else {
  initAdminClient();
}
