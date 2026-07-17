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
  const events = createEventListController({
    selectEvent: details.selectEvent,
    selectMailboxMessage: details.selectMailboxMessage,
  });

  function renderRoute() {
    const onSettings = window.location.pathname.replace(/\/+$/, "") === "/admin/settings";
    const shell = qs("appShell");
    const settingsPage = qs("settingsPage");
    if (shell) shell.hidden = onSettings;
    if (settingsPage) settingsPage.hidden = !onSettings;
    document.body.classList.toggle("settings-route", onSettings);
  }

  function navigate(path) {
    window.history.pushState({}, "", path);
    renderRoute();
    window.scrollTo({ top: 0, left: 0, behavior: "smooth" });
  }

  function initPanelToggles() {
    document.querySelectorAll(".collapsible-panel").forEach((panel) => {
      const button = panel.querySelector(".panel-toggle");
      const chevron = panel.querySelector(".panel-chevron");
      if (!button) return;

      const setCollapsed = (collapsed) => {
        panel.classList.toggle("collapsed", collapsed);
        button.setAttribute("aria-expanded", String(!collapsed));
        if (chevron) chevron.textContent = collapsed ? "expand_more" : "expand_less";
      };

      setCollapsed(panel.classList.contains("collapsed"));
      button.addEventListener("click", () => setCollapsed(!panel.classList.contains("collapsed")));
    });
  }

  function initMobileNavigation() {
    const scrollTo = (selector) => {
      document.querySelector(selector)?.scrollIntoView({ behavior: "smooth", block: "start" });
    };
    document.querySelector(".mobile-nav-mailbox")?.addEventListener("click", () => scrollTo(".sidebar"));
    document.querySelector(".mobile-nav-detail")?.addEventListener("click", () => scrollTo(".detail-header"));
    document.querySelector(".mobile-nav-events")?.addEventListener("click", () => scrollTo(".panes"));
    document.querySelector(".mobile-nav-settings")?.addEventListener("click", () => navigate("/admin/settings"));
    document.querySelector(".mobile-nav-primary")?.addEventListener("click", () => qs("reprocessButton")?.click());
  }

  document.getElementById("settingsButton").addEventListener("click", () => navigate("/admin/settings"));
  document.getElementById("closeSettingsButton").addEventListener("click", () => navigate("/admin/"));
  document.getElementById("refreshButton").addEventListener("click", events.scanWatcherThenReload);
  window.addEventListener("popstate", renderRoute);

  settings.initRevealButtons();
  settings.initSettingsSectionView();
  settings.initManualAnalyzeLatestEmailButton();
  settings.initManualSendLatestDocumentButton();
  settings.initWatcherIgnoreBeforeButton();
  settings.initWatcherResetStateButton();
  settings.initWatcherScanButton();
  settings.initDiagnosticsLogger();
  events.initNotifications();
  events.initSearchControls();
  events.initSelectionControls();
  learning.initLearningControls();
  initSidebarToggle();
  initPanelToggles();
  initMobileNavigation();
  qs("settingsForm").addEventListener("submit", settings.saveSettings);

  const baseInput = qs("aiBaseUrl");
  if (baseInput) baseInput.addEventListener("input", settings.suggestModelBasedOnBaseUrl);

  settings.loadSettings();
  learning.loadLearningSummary();
  events.loadEvents();
  events.startMailboxIndexPolling();
  renderRoute();
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", initAdminClient);
} else {
  initAdminClient();
}
