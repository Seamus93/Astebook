import { mkdir, readFile, appendFile, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { randomUUID } from "node:crypto";

const runtimeDir = process.env.RUNTIME_DIR || join(process.cwd(), "runtime");
const logFile = process.env.PROCESSING_LOG_FILE || join(runtimeDir, "processing-events.jsonl");

function nowIso() {
  return new Date().toISOString();
}

function sanitizeFiles(files) {
  return Array.isArray(files)
    ? files.map((file) => ({
        fieldname: file.fieldname,
        originalname: file.originalname,
        mimetype: file.mimetype,
        size: file.size,
        encoding: file.encoding,
      }))
    : [];
}

async function ensureLogFile() {
  await mkdir(runtimeDir, { recursive: true });
  if (!existsSync(logFile)) {
    await writeFile(logFile, "", "utf8");
  }
}

async function readEvents() {
  await ensureLogFile();
  const raw = await readFile(logFile, "utf8");
  return raw
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line));
}

async function writeEvents(events) {
  await ensureLogFile();
  const content = events.map((event) => JSON.stringify(event)).join("\n");
  await writeFile(logFile, content ? `${content}\n` : "", "utf8");
}

function valueAt(obj, path) {
  return path.split(".").reduce((current, key) => current?.[key], obj);
}

function firstValue(obj, paths, fallback = "") {
  for (const path of paths) {
    const value = valueAt(obj, path);
    if (value !== undefined && value !== null && String(value).trim() !== "") return String(value);
  }
  return fallback;
}

function eventSearchSummary(event) {
  const result = event.result || {};
  const extracted = result.extracted || {};
  const annuncio = extracted.annuncio || result.zapier_response?.annuncio || {};
  const proposta = extracted.proposta || result.zapier_response?.proposta || {};
  const body = event.request?.body || {};

  return {
    subject: firstValue({ event, body }, ["event.metadata.subject", "body.subject"]),
    from: firstValue({ event, body }, ["event.metadata.from", "body.from", "body.sender"]),
    codice_pratica: firstValue({ result, event }, ["result.codice_pratica", "event.metadata.codice_pratica"]),
    procedura: firstValue({ result, event, body }, ["result.codice_pratica", "event.metadata.subject", "body.subject"]),
    proponente: firstValue(
      { proposta, body },
      ["proposta.proponente.nominativo", "proposta.proponente", "body.proponente", "body.nominativo"]
    ),
    azienda: firstValue(
      { annuncio, proposta, body },
      ["annuncio.azienda", "annuncio.procedura", "proposta.azienda", "body.azienda", "body.company"]
    ),
  };
}

function eventErrorCount(event) {
  const missingFields = Array.isArray(event.error?.missing_fields) ? event.error.missing_fields.length : 0;
  const stepErrors = Array.isArray(event.steps)
    ? event.steps.filter((step) => step.level === "error").length
    : 0;
  const genericError = event.error && missingFields === 0 ? 1 : 0;
  return missingFields + stepErrors + genericError;
}

export async function createProcessingEvent({ source, status = "received", body, files, metadata = {} }) {
  await ensureLogFile();
  const event = {
    id: randomUUID(),
    source,
    status,
    metadata,
    received_at: nowIso(),
    updated_at: nowIso(),
    request: {
      body: body || {},
      files: sanitizeFiles(files),
    },
    steps: [
      {
        at: nowIso(),
        level: "info",
        message: "Request received",
      },
    ],
    result: null,
    error: null,
  };

  await appendFile(logFile, `${JSON.stringify(event)}\n`, "utf8");
  return event;
}

export async function updateProcessingEvent(id, patch, step) {
  const events = await readEvents();
  const index = events.findIndex((event) => event.id === id);
  if (index === -1) return null;

  const current = events[index];
  const next = {
    ...current,
    ...patch,
    updated_at: nowIso(),
    steps: [
      ...(current.steps || []),
      ...(step
        ? [
            {
              at: nowIso(),
              level: step.level || "info",
              message: step.message,
              data: step.data,
            },
          ]
        : []),
    ],
  };

  events[index] = next;
  await writeEvents(events);
  return next;
}

export async function listProcessingEvents({ limit = 100 } = {}) {
  const events = await readEvents();
  return events
    .sort((a, b) => String(b.received_at).localeCompare(String(a.received_at)))
    .slice(0, limit)
    .map((event) => ({
      id: event.id,
      source: event.source,
      status: event.status,
      received_at: event.received_at,
      updated_at: event.updated_at,
      metadata: event.metadata,
      file_count: event.request?.files?.length || 0,
      has_result: Boolean(event.result),
      has_error: Boolean(event.error),
      error_count: eventErrorCount(event),
      search: eventSearchSummary(event),
    }));
}

export async function getProcessingEvent(id) {
  const events = await readEvents();
  return events.find((event) => event.id === id) || null;
}
