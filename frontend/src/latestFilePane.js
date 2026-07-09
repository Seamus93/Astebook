const EVENT_DETAIL_RE = /\/api\/v1\/processing-events\/([^/?#]+)$/;

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function fileNameFrom(value, fallback = "File") {
  return String(
    value?.file_name ||
      value?.file_pdf ||
      value?.originalname ||
      value?.filename ||
      value?.name ||
      value?.field_name ||
      value?.fieldname ||
      fallback
  );
}

function normalized(value) {
  return String(value || "").trim().toLowerCase();
}

function isImageFile(fileOrName) {
  const name = typeof fileOrName === "string" ? fileOrName : fileNameFrom(fileOrName, "");
  const mime =
    typeof fileOrName === "string"
      ? ""
      : fileOrName?.mime_type || fileOrName?.mimetype || fileOrName?.file_mime_type || "";
  const format = typeof fileOrName === "string" ? "" : fileOrName?.format || "";
  return (
    normalized(format) === "image" ||
    normalized(format) === "png" ||
    normalized(mime).startsWith("image/") ||
    /\.(png|jpe?g|gif|webp|bmp|tiff?|heic)$/i.test(String(name || ""))
  );
}

function stepFileName(step) {
  return fileNameFrom(step?.data, "");
}

function isFileStep(step) {
  return Boolean(stepFileName(step));
}

function latestExtractionStartIndex(steps) {
  const markers = [
    /Manual reprocess requested/i,
    /Payload normalized for AI extraction/i,
    /AI extraction started/i,
  ];

  for (let i = steps.length - 1; i >= 0; i -= 1) {
    if (markers.some((pattern) => pattern.test(steps[i]?.message || ""))) return i;
  }

  return 0;
}

function latestFileSteps(event) {
  const steps = Array.isArray(event?.steps) ? event.steps : [];
  const start = latestExtractionStartIndex(steps);
  return steps.slice(start).filter(isFileStep);
}

function filesForLatestExtraction(event) {
  const groups = new Map();
  const addFile = (file, index) => {
    if (isImageFile(file)) return;
    const fileName = fileNameFrom(file, `File ${index + 1}`);
    if (!groups.has(fileName)) groups.set(fileName, { fileName, file, steps: [] });
  };

  (event?.result?.attachments || event?.request?.files || []).forEach(addFile);

  latestFileSteps(event).forEach((step) => {
    const fileName = stepFileName(step);
    if (isImageFile(fileName)) return;
    if (!groups.has(fileName)) groups.set(fileName, { fileName, file: { file_name: fileName }, steps: [] });
    groups.get(fileName).steps.push(step);
  });

  return Array.from(groups.values()).filter((group) => group.steps.length > 0 || group.file);
}

function descriptorRows(file) {
  const rows = [
    ["Formato", file?.format || file?.mime_type || file?.mimetype || "-"],
    ["Kind", file?.kind || "-"],
    ["Supported By Extraction", file?.supported_by_extraction ?? file?.supported_by_scraper ?? "-"],
    ["Size", file?.size ?? "-"],
  ];

  return rows
    .map(([key, value]) => `
      <div class="kv-row">
        <div class="kv-key">${escapeHtml(key)}</div>
        <div class="kv-value">${escapeHtml(value === true ? "Si" : value === false ? "No" : value)}</div>
      </div>`)
    .join("");
}

function stepHtml(step) {
  const levelClass = step.level === "error" ? " error" : "";
  const detailRows = step.data
    ? Object.entries(step.data)
        .map(([key, value]) => `
          <div class="kv-row">
            <div class="kv-key">${escapeHtml(key.replace(/_/g, " "))}</div>
            <div class="kv-value">${escapeHtml(typeof value === "object" ? JSON.stringify(value, null, 2) : value)}</div>
          </div>`)
        .join("")
    : "";

  return `
    <div class="step${levelClass}">
      <strong>${escapeHtml(step.message || "Step")}</strong>
      <span>${escapeHtml(step.at || "")}</span>
      ${detailRows ? `<div class="step-data"><div class="kv-list">${detailRows}</div></div>` : ""}
    </div>`;
}

function renderLatestFilesPane(event) {
  const pane = document.getElementById("filesPane");
  if (!pane) return;

  const groups = filesForLatestExtraction(event);
  pane.innerHTML = "";

  if (!groups.length) {
    pane.innerHTML = `<p class="empty-state">Nessun file elaborato nell'ultima estrazione.</p>`;
    return;
  }

  const marker = document.createElement("p");
  marker.className = "latest-extraction-note";
  marker.textContent = "Vista filtrata: solo file e log dell'ultima estrazione.";
  pane.append(marker);

  groups.forEach(({ fileName, file, steps }) => {
    const details = document.createElement("details");
    details.className = "data-section file-section";
    details.open = steps.some((step) => step.level === "error");
    details.innerHTML = `
      <summary>
        <span>${escapeHtml(fileName)}</span>
        <small>${escapeHtml(file?.format || file?.mime_type || file?.mimetype || "-")} · ${steps.length} log ultima estrazione</small>
      </summary>
      <div class="file-descriptor"><div class="kv-list">${descriptorRows(file)}</div></div>
      ${steps.length ? `<div class="file-steps">${steps.map(stepHtml).join("")}</div>` : ""}`;
    pane.append(details);
  });
}

function initLatestFilePane() {
  const originalFetch = window.fetch.bind(window);

  window.fetch = async (...args) => {
    const response = await originalFetch(...args);
    const method = String(args[1]?.method || "GET").toUpperCase();
    const url = String(args[0]?.url || args[0] || "");

    if (method === "GET" && EVENT_DETAIL_RE.test(url)) {
      response
        .clone()
        .json()
        .then((payload) => {
          if (payload?.event) window.setTimeout(() => renderLatestFilesPane(payload.event), 0);
        })
        .catch(() => {});
    }

    return response;
  };
}

initLatestFilePane();
