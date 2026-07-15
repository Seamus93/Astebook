import { qs } from "./dom.js";

export function initSidebarToggle() {
  const shell = qs("appShell");
  const buttons = [qs("sidebarToggleButton"), qs("sidebarRestoreButton")].filter(Boolean);
  if (!shell || !buttons.length) return;

  const applyState = (collapsed) => {
    shell.classList.toggle("sidebar-collapsed", collapsed);
    buttons.forEach((button) => {
      button.setAttribute("aria-expanded", String(!collapsed));
      button.title = collapsed ? "Apri elenco lavorazioni" : "Chiudi elenco lavorazioni";
      button.setAttribute(
        "aria-label",
        collapsed ? "Apri elenco lavorazioni" : "Chiudi elenco lavorazioni"
      );
    });
  };

  const toggle = () => {
    const collapsed = !shell.classList.contains("sidebar-collapsed");
    localStorage.setItem("astebook_sidebar_collapsed", collapsed ? "1" : "0");
    applyState(collapsed);
  };

  applyState(localStorage.getItem("astebook_sidebar_collapsed") === "1");
  buttons.forEach((button) => button.addEventListener("click", toggle));
}
