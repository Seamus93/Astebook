import { escapeHtml } from "./html.js";

export function showToast({ title = "", message = "", items = [], tone = "error" } = {}) {
  let host = document.getElementById("toastHost");
  if (!host) {
    host = document.createElement("div");
    host.id = "toastHost";
    host.className = "toast-host";
    document.body.appendChild(host);
  }

  const toast = document.createElement("div");
  toast.className = `toast ${tone}`;
  const itemList = items.length
    ? `<ul>${items.map((item) => `<li>${escapeHtml(item)}</li>`).join("")}</ul>`
    : "";
  toast.innerHTML = `
    <div class="toast-icon"><span class="material-symbols-outlined" aria-hidden="true">${tone === "error" ? "error" : "info"}</span></div>
    <div class="toast-body">
      ${title ? `<strong>${escapeHtml(title)}</strong>` : ""}
      ${message ? `<p>${escapeHtml(message)}</p>` : ""}
      ${itemList}
    </div>
    <button class="icon-button toast-close" type="button" title="Chiudi">
      <span class="material-symbols-outlined" aria-hidden="true">close</span>
    </button>`;
  host.appendChild(toast);

  const close = () => toast.remove();
  toast.querySelector(".toast-close")?.addEventListener("click", close);
  window.setTimeout(close, 9000);
}
