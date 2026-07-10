import { qs } from "./dom.js";

export function initSidebarToggle() {
  const shell = qs("appShell");
  const button = qs("sidebarToggleButton");
  if (!shell || !button) return;

  const applyState = (collapsed) => {
    shell.classList.toggle("sidebar-collapsed", collapsed);
    button.setAttribute("aria-expanded", String(!collapsed));
    button.title = collapsed ? "Apri elenco lavorazioni" : "Chiudi elenco lavorazioni";
  };

  applyState(localStorage.getItem("astebook_sidebar_collapsed") === "1");

  button.addEventListener("click", () => {
    const collapsed = !shell.classList.contains("sidebar-collapsed");
    localStorage.setItem("astebook_sidebar_collapsed", collapsed ? "1" : "0");
    applyState(collapsed);
  });
}
