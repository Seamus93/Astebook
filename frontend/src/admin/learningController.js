import { apiFetch } from "./apiClient.js";
import { qs } from "./dom.js";

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function renderCountList(items, emptyText) {
  if (!Array.isArray(items) || !items.length) {
    return `<p class="empty-state">${emptyText}</p>`;
  }
  return `
    <ul class="learning-list">
      ${items.map((item) => `
        <li>
          <span>${escapeHtml(item.key)}</span>
          <strong>${escapeHtml(item.count)}</strong>
        </li>
      `).join("")}
    </ul>
  `;
}

function renderRecent(items) {
  if (!Array.isArray(items) || !items.length) {
    return `<p class="empty-state">Nessuna correzione salvata.</p>`;
  }
  return `
    <div class="learning-recent-list">
      ${items.map((item) => `
        <article class="learning-recent-item">
          <strong>${escapeHtml(item.field_path)}</strong>
          <span>${escapeHtml(item.corrected_value ?? "null")}</span>
          <small>${escapeHtml(item.source_file || "Fonte non indicata")}${item.created_at ? ` · ${escapeHtml(item.created_at)}` : ""}</small>
        </article>
      `).join("")}
    </div>
  `;
}

export function createLearningController() {
  async function loadLearningSummary() {
    const pane = qs("learningPane");
    if (!pane) return;

    pane.innerHTML = '<p class="empty-state">Caricamento memoria AI...</p>';
    try {
      const resp = await apiFetch("/api/v1/extraction-feedback/summary");
      const data = await resp.json().catch(() => ({}));
      if (!resp.ok || data.ok === false) {
        throw new Error(data.error || `HTTP ${resp.status}`);
      }

      const summary = data.summary || {};
      pane.innerHTML = `
        <div class="learning-total">
          <strong>${summary.total || 0}</strong>
          <span>correzioni validate</span>
        </div>
        <div class="learning-grid">
          <section>
            <h3>Ambiti</h3>
            ${renderCountList(summary.by_scope, "Nessun ambito ancora disponibile.")}
          </section>
          <section>
            <h3>Campi piu corretti</h3>
            ${renderCountList(summary.top_fields, "Nessun campo ancora corretto.")}
          </section>
        </div>
        <section>
          <h3>Ultime correzioni</h3>
          ${renderRecent(summary.recent)}
        </section>
      `;
    } catch (error) {
      pane.innerHTML = `<p class="empty-state">Memoria AI non disponibile: ${escapeHtml(error.message || String(error))}</p>`;
    }
  }

  function initLearningControls() {
    const refreshButton = qs("refreshLearningButton");
    if (refreshButton) {
      refreshButton.addEventListener("click", loadLearningSummary);
    }
  }

  return {
    initLearningControls,
    loadLearningSummary,
  };
}
