import { renderStructured } from "./structuredView.js";

export function fileNameFromStep(step) {
  return step?.data?.file_name || step?.data?.file_pdf || step?.data?.file || null;
}

function isFileStep(step) {
  return Boolean(fileNameFromStep(step));
}

function fileDisplayName(file, fallback = "File") {
  return file?.file_name || file?.originalname || file?.filename || file?.name || file?.field_name || file?.fieldname || fallback;
}

function normalizeFileText(value) {
  return String(value || "").trim().toLowerCase();
}

function isImageFile(fileOrName) {
  const name =
    typeof fileOrName === "string"
      ? fileOrName
      : fileDisplayName(fileOrName, "");
  const mime =
    typeof fileOrName === "string"
      ? ""
      : fileOrName?.mime_type || fileOrName?.mimetype || fileOrName?.file_mime_type || "";
  const format = typeof fileOrName === "string" ? "" : fileOrName?.format || "";
  return (
    normalizeFileText(format) === "image" ||
    normalizeFileText(format) === "png" ||
    normalizeFileText(mime).startsWith("image/") ||
    /\.(png|jpe?g|gif|webp|bmp|tiff?|heic)$/i.test(String(name || ""))
  );
}

function pipelineSteps(event) {
  return (event.steps || []).filter((step) => !isFileStep(step));
}

function fileStepGroups(event) {
  const groups = new Map();
  (event.result?.attachments || event.request?.files || []).forEach((file) => {
    if (isImageFile(file)) return;
    const fileName = fileDisplayName(file);
    if (!groups.has(fileName)) groups.set(fileName, { file, steps: [] });
  });

  (event.steps || []).filter(isFileStep).forEach((step) => {
    const fileName = fileNameFromStep(step);
    if (isImageFile(fileName)) return;
    if (!groups.has(fileName)) groups.set(fileName, { file: { file_name: fileName }, steps: [] });
    groups.get(fileName).steps.push(step);
  });

  return Array.from(groups.entries()).map(([fileName, group]) => ({ fileName, ...group }));
}

function renderStepItem(step) {
  const item = document.createElement("div");
  item.className = `step ${step.level === "error" ? "error" : ""}`;

  const message = document.createElement("strong");
  message.textContent = step.message;
  const date = document.createElement("span");
  date.textContent = step.at || "";
  item.append(message, date);

  if (step.data) {
    const dataContainer = document.createElement("div");
    dataContainer.className = "step-data";
    renderStructured(dataContainer, step.data, "Nessun dettaglio.");
    item.appendChild(dataContainer);
  }

  return item;
}

export function renderPipelineSteps(event) {
  const stepsPane = document.getElementById("stepsPane");
  if (!stepsPane) return;
  stepsPane.innerHTML = "";
  const steps = pipelineSteps(event);
  if (!steps.length) {
    const empty = document.createElement("p");
    empty.className = "empty-state";
    empty.textContent = "Nessuno step generale registrato.";
    stepsPane.appendChild(empty);
    return;
  }
  steps.forEach((step) => stepsPane.appendChild(renderStepItem(step)));
}

export function renderFileSections(event) {
  const filesPane = document.getElementById("filesPane");
  if (!filesPane) return;
  filesPane.innerHTML = "";
  const groups = fileStepGroups(event);
  if (!groups.length) {
    const empty = document.createElement("p");
    empty.className = "empty-state";
    empty.textContent = "Nessun file ricevuto.";
    filesPane.appendChild(empty);
    return;
  }

  groups.forEach(({ fileName, file, steps }) => {
    const details = document.createElement("details");
    details.className = "data-section file-section";
    details.open = steps.some((step) => step.level === "error");

    const summary = document.createElement("summary");
    const title = document.createElement("span");
    title.textContent = fileName;
    const meta = document.createElement("small");
    meta.textContent = `${file.format || file.mime_type || file.mimetype || "-"} · ${steps.length} log`;
    summary.append(title, meta);
    details.appendChild(summary);

    const descriptor = {
      field_name: file.field_name || file.fieldname || null,
      mime_type: file.file_mime_type || file.mimetype || file.mime_type || null,
      format: file.format || null,
      kind: file.kind || null,
      supported_by_scraper: file.supported_by_scraper,
      size: file.size || null,
    };
    const descriptorContainer = document.createElement("div");
    descriptorContainer.className = "file-descriptor";
    renderStructured(descriptorContainer, descriptor, "Nessun dettaglio file.");
    details.appendChild(descriptorContainer);

    if (steps.length) {
      const stepList = document.createElement("div");
      stepList.className = "file-steps";
      steps.forEach((step) => stepList.appendChild(renderStepItem(step)));
      details.appendChild(stepList);
    }

    filesPane.appendChild(details);
  });
}
