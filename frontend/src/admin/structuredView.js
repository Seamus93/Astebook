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

function appendValue(container, key, value) {
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
      value.forEach((item, index) => appendValue(details, `${key} ${index + 1}`, item));
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
        appendValue(details, childKey, childValue);
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
      row.append(keyEl, valueEl);
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
  row.append(keyEl, valueEl);
  container.appendChild(row);
}

export function renderStructured(container, value, emptyLabel) {
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
    Object.entries(value).forEach(([key, childValue]) => appendValue(container, key, childValue));
    return;
  }

  appendValue(container, "Valore", value);
}
