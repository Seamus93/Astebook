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
    }));
}

export async function getProcessingEvent(id) {
  const events = await readEvents();
  return events.find((event) => event.id === id) || null;
}
