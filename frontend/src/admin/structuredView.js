import { apiFetch } from "./apiClient.js";
import { showToast } from "./toast.js";

function isPlainObject(value) {
  return value && typeof value === "object" && !Array.isArray(value);
}

function primitiveText(value) {
  if (value === null || value === undefined || value === "") return "-";
  if (typeof value === "boolean") return value ? "Si" : "No";
  return String(value);
}

function labelFor(key) {
  const labels = {
    body: "Corpo email",
    request: "Richiesta",
    files: "File",
    extracted: "Estratto",
    missing_fields: "Campi mancanti",
    error: "Errore",
    notes: "Note",
    file_name: "Nome file",
    originalname: "Nome originale",
    fieldname: "Field",
    mimetype: "Mime type",
    size: "Dimensione",
    url: "URL",
    subject: "Oggetto",
    from: "Mittente",
    codice_pratica: "Codice pratica",
    zap_run_id: "Zap Run ID",
    email_id: "Email ID",
    status: "Stato",
    source: "Origine",
    received_at: "Ricevuto il",
    updated_at: "Aggiornato il",
    has_body_text: "Testo email disponibile",
    note: "Nota",
  };
  return labels[key] || key.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

async function sendExtractionFeedback({ eventId, fieldPath, value, rating, correctedValue, reason }) {
  if (!eventId || !fieldPath) return;
  const positive = rating === "positive";
  const payload = {
    field_path: fieldPath,
    ai_value: value,
    corrected_value: correctedValue !== undefined ? correctedValue : positive ? value : null,
    reason: reason || (positive
      ? "Dato estratto confermato manualmente dalla UI."
      : "Dato estratto segnalato come non corretto dalla UI."),
    rating,
    apply: false,
  };
  const response = await apiFetch(`/api/v1/processing-events/${eventId}/feedback`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload),
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok || body.ok === false) {
    throw new Error(body.error || `HTTP ${response.status}`);
  }
}

function removeCorrectionForms(row) {
  row.querySelectorAll(".field-feedback-correction").forEach((form) => form.remove());
}

function showCorrectionForm({ button, group, eventId, path, value }) {
  const row = group.closest(".kv-row");
  if (!row) return;
  removeCorrectionForms(row);

  const form = document.createElement("form");
  form.className = "field-feedback-correction";
  form.innerHTML = `
    <label>
      <span>Quale e il valore corretto?</span>
      <input name="corrected_value" type="text" required />
    </label>
    <label>
      <span>Aiuta l'AI a riconoscerlo</span>
      <textarea name="reason" rows="2" placeholder="Es. si trova nella sezione Identificazione catastale, vicino a foglio/particella..."></textarea>
    </label>
    <div class="field-feedback-correction-actions">
      <button class="secondary-button" type="button" data-cancel>Annulla</button>
      <button class="primary-button" type="submit">Salva</button>
    </div>
  `;

  form.querySelector("[data-cancel]")?.addEventListener("click", () => {
    button.classList.remove("active");
    form.remove();
  });

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    const data = new FormData(form);
    const correctedValue = String(data.get("corrected_value") || "").trim();
    const hint = String(data.get("reason") || "").trim();
    if (!correctedValue) return;

    group.querySelectorAll("button").forEach((item) => {
      item.disabled = true;
    });
    form.querySelectorAll("button, input, textarea").forEach((item) => {
      item.disabled = true;
    });

    try {
      await sendExtractionFeedback({
        eventId,
        fieldPath: path,
        value,
        rating: "negative",
        correctedValue,
        reason: [
          "Dato estratto corretto manualmente dalla UI.",
          hint ? `Indicazione per AI: ${hint}` : "",
        ].filter(Boolean).join(" "),
      });
      showToast({
        title: "Correzione salvata",
        message: "Il valore corretto e la nota saranno usati come memoria per l'AI.",
        tone: "info",
      });
      form.remove();
    } catch (error) {
      button.classList.remove("active");
      showToast({
        title: "Feedback non salvato",
        message: error.message || String(error),
        tone: "error",
      });
      form.querySelectorAll("button, input, textarea").forEach((item) => {
        item.disabled = false;
      });
    } finally {
      group.querySelectorAll("button").forEach((item) => {
        item.disabled = false;
      });
    }
  });

  row.appendChild(form);
  form.querySelector("input")?.focus();
}

function feedbackActions({ eventId, path, value }) {
  if (!eventId || !String(path || "").startsWith("extracted.")) return null;

  const group = document.createElement("div");
  group.className = "field-feedback-actions";
  group.setAttribute("aria-label", "Feedback dato estratto");

  [
    ["positive", "thumb_up", "Dato corretto"],
    ["negative", "thumb_down", "Dato non corretto"],
  ].forEach(([rating, icon, title]) => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = `field-feedback-button ${rating}`;
    button.title = title;
    button.innerHTML = `<span class="material-symbols-outlined" aria-hidden="true">${icon}</span>`;
    button.addEventListener("click", async (event) => {
      event.preventDefault();
      event.stopPropagation();
      if (rating === "negative") {
        group.querySelectorAll("button").forEach((item) => item.classList.remove("active"));
        button.classList.add("active");
        showCorrectionForm({ button, group, eventId, path, value });
        return;
      }
      group.querySelectorAll("button").forEach((item) => {
        item.disabled = true;
        item.classList.remove("active");
      });
      button.classList.add("active");
      try {
        await sendExtractionFeedback({ eventId, fieldPath: path, value, rating });
        showToast({
          title: rating === "positive" ? "Feedback positivo salvato" : "Feedback negativo salvato",
          message: rating === "positive"
            ? "Questo dato aiutera l'AI a riconoscere estrazioni corrette."
            : "Questo dato verra usato come segnale di controllo per l'AI.",
          tone: "info",
        });
      } catch (error) {
        button.classList.remove("active");
        showToast({
          title: "Feedback non salvato",
          message: error.message || String(error),
          tone: "error",
        });
      } finally {
        group.querySelectorAll("button").forEach((item) => {
          item.disabled = false;
        });
      }
    });
    group.appendChild(button);
  });

  return group;
}

function appendValue(container, key, value, options = {}, path = key) {
  if (Array.isArray(value)) {
    const details = document.createElement("details");
    details.className = "data-section";
    details.open = value.length <= 3;

    const summary = document.createElement("summary");
    summary.textContent = `${labelFor(key)} (${value.length})`;
    details.appendChild(summary);

    if (value.length === 0) {
      const empty = document.createElement("p");
      empty.className = "empty-state";
      empty.textContent = "Nessun valore.";
      details.appendChild(empty);
    } else {
      value.forEach((item, index) => appendValue(details, `${key} ${index + 1}`, item, options, `${path}.${index}`));
    }

    container.appendChild(details);
    return;
  }

  if (isPlainObject(value)) {
    const details = document.createElement("details");
    details.className = "data-section";
    details.open = true;

    const summary = document.createElement("summary");
    summary.textContent = labelFor(key);
    details.appendChild(summary);

    const list = document.createElement("div");
    list.className = "kv-list";

    Object.entries(value).forEach(([childKey, childValue]) => {
      if (isPlainObject(childValue) || Array.isArray(childValue)) {
        appendValue(details, childKey, childValue, options, `${path}.${childKey}`);
        return;
      }

      const row = document.createElement("div");
      row.className = "kv-row";
      const keyEl = document.createElement("div");
      keyEl.className = "kv-key";
      keyEl.textContent = labelFor(childKey);
      const valueEl = document.createElement("div");
      valueEl.className = "kv-value";
      valueEl.textContent = primitiveText(childValue);
      const actions = feedbackActions({ eventId: options.feedbackEventId, path: `${path}.${childKey}`, value: childValue });
      row.append(keyEl, valueEl);
      if (actions) row.appendChild(actions);
      list.appendChild(row);
    });

    details.appendChild(list);
    container.appendChild(details);
    return;
  }

  const row = document.createElement("div");
  row.className = "kv-row";
  const keyEl = document.createElement("div");
  keyEl.className = "kv-key";
  keyEl.textContent = labelFor(key);
  const valueEl = document.createElement("div");
  valueEl.className = "kv-value";
  valueEl.textContent = primitiveText(value);
  const actions = feedbackActions({ eventId: options.feedbackEventId, path, value });
  row.append(keyEl, valueEl);
  if (actions) row.appendChild(actions);
  container.appendChild(row);
}

export function renderStructured(container, value, emptyLabel, options = {}) {
  if (!container) return;
  container.innerHTML = "";
  const isEmpty =
    value === null ||
    value === undefined ||
    value === "" ||
    (Array.isArray(value) && value.length === 0) ||
    (isPlainObject(value) && Object.keys(value).length === 0);

  if (isEmpty) {
    const empty = document.createElement("p");
    empty.className = "empty-state";
    empty.textContent = emptyLabel;
    container.appendChild(empty);
    return;
  }

  if (isPlainObject(value)) {
    Object.entries(value).forEach(([key, childValue]) => appendValue(container, key, childValue, options, key));
    return;
  }

  appendValue(container, "Valore", value, options, "Valore");
}
