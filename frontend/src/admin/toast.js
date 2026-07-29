import { escapeHtml } from "./html.js";

export function showToast({ title = "", message = "", items = [], actions = [], tone = "error" } = {}) {
  let host = document.getElementById("toastHost");
  if (!host) {
    host = document.createElement("div");
    host.id = "toastHost";
    host.className = "toast-host";
    document.body.appendChild(host);
  }
  host.innerHTML = "";

  const toast = document.createElement("div");
  toast.className = `toast ${tone === "error" ? "notice" : tone}`;
  const itemList = items.length
    ? `<ul>${items.map((item) => `<li>${escapeHtml(item)}</li>`).join("")}</ul>`
    : "";
  toast.innerHTML = `
    <div class="toast-icon"><span class="material-symbols-outlined" aria-hidden="true">${tone === "error" ? "info" : "info"}</span></div>
    <div class="toast-body">
      ${title ? `<strong>${escapeHtml(title)}</strong>` : ""}
      ${message ? `<p>${escapeHtml(message)}</p>` : ""}
      ${itemList}
      ${actions.length ? `<div class="toast-actions"></div>` : ""}
    </div>
    <button class="icon-button toast-close" type="button" title="Chiudi">
      <span class="material-symbols-outlined" aria-hidden="true">close</span>
    </button>`;
  host.appendChild(toast);

  const close = () => toast.remove();
  toast.querySelector(".toast-close")?.addEventListener("click", close);
  const actionsContainer = toast.querySelector(".toast-actions");
  actions.forEach((action) => {
    if (!actionsContainer || !action?.label) return;
    const button = document.createElement("button");
    button.type = "button";
    button.className = "secondary-button toast-action";
    button.textContent = action.label;
    if (action.title) button.title = action.title;
    button.addEventListener("click", () => {
      close();
      action.onClick?.();
    });
    actionsContainer.appendChild(button);
  });
  window.setTimeout(close, 9000);
}
