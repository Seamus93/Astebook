import { randomUUID } from "node:crypto";
import { Prisma } from "@prisma/client";
import { getPrismaClient } from "./db.js";

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

function jsonDbValue(value) {
  if (value === undefined) return undefined;
  return value === null ? Prisma.DbNull : value;
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

function eventFromDb(row) {
  if (!row) return null;
  return {
    id: row.id,
    source: row.source,
    status: row.status,
    metadata: row.metadata || {},
    received_at: row.receivedAt?.toISOString?.() || null,
    updated_at: row.updatedAt?.toISOString?.() || null,
    request: row.request || null,
    steps: (row.steps || []).map((step) => ({
      at: step.at?.toISOString?.() || null,
      level: step.level || "info",
      message: step.message,
      data: step.data || undefined,
    })),
    result: row.result || null,
    error: row.error || null,
  };
}

function dbPatchFromEventPatch(patch = {}) {
  const data = {};
  if ("source" in patch) data.source = patch.source;
  if ("status" in patch) data.status = patch.status;
  if ("metadata" in patch) data.metadata = jsonDbValue(patch.metadata);
  if ("request" in patch) data.request = jsonDbValue(patch.request);
  if ("result" in patch) data.result = jsonDbValue(patch.result);
  if ("error" in patch) data.error = jsonDbValue(patch.error);
  if ("received_at" in patch) {
    const receivedAt = new Date(patch.received_at);
    if (Number.isFinite(receivedAt.getTime())) data.receivedAt = receivedAt;
  }
  return data;
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

function eventErrorSummary(event) {
  const missingFields = Array.isArray(event.error?.missing_fields)
    ? event.error.missing_fields.map((field) => field.message || field.field || "Dato mancante")
    : [];
  const stepErrors = Array.isArray(event.steps)
    ? event.steps
        .filter((step) => step.level === "error")
        .map((step) => step.message || "Errore elaborazione")
    : [];
  const genericError = event.error?.message && missingFields.length === 0 ? [event.error.message] : [];
  return [...missingFields, ...stepErrors, ...genericError];
}

function eventWorkflowIssue(event) {
  const steps = Array.isArray(event.steps) ? event.steps : [];
  const missingFields = Array.isArray(event.error?.missing_fields) ? event.error.missing_fields : [];

  if (event.status === "completed" && eventErrorCount(event) === 0) return null;
  if (!event.received_at) {
    return {
      step: "Mail",
      message: "Mail non ricevuta correttamente.",
      details: [],
    };
  }

  const ocrStep = steps.find(
    (step) =>
      /PDF-app OCR skipped|PDF-app OCR failed/i.test(step.message || "") ||
      (step.level === "error" && /ocr/i.test(step.message || ""))
  );
  if (ocrStep) {
    return {
      step: "OCR",
      message: ocrStep.data?.reason || ocrStep.data?.error || ocrStep.message || "OCR non completato.",
      details: eventErrorSummary(event).slice(0, 6),
    };
  }

  const extractionStep = steps.find(
    (step) => step.level === "error" && /extraction|estrazione/i.test(step.message || "")
  );
  if (extractionStep || missingFields.length > 0 || event.result?.ready_for_zapier === false) {
    return {
      step: "AI Extraction",
      message:
        missingFields.length > 0
          ? `${missingFields.length} dati mancanti dopo l'estrazione.`
          : extractionStep?.message || "Estrazione incompleta.",
      details: eventErrorSummary(event).slice(0, 6),
    };
  }

  if (event.status === "failed" || event.error) {
    return {
      step: "Completo",
      message: event.error?.message || "Lavorazione non completata.",
      details: eventErrorSummary(event).slice(0, 6),
    };
  }

  return null;
}

export async function createProcessingEvent({ source, status = "received", body, files, metadata = {} }) {
  const prisma = getPrismaClient();
  const event = await prisma.processingEvent.create({
    data: {
      id: randomUUID(),
      source,
      status,
      metadata: jsonDbValue(metadata),
      request: {
        body: body || {},
        files: sanitizeFiles(files),
      },
      result: Prisma.DbNull,
      error: Prisma.DbNull,
      steps: {
        create: {
          at: new Date(),
          level: "info",
          message: "Request received",
        },
      },
    },
    include: { steps: { orderBy: [{ at: "asc" }, { id: "asc" }] } },
  });
  return eventFromDb(event);
}

export async function updateProcessingEvent(id, patch = {}, step = null) {
  const prisma = getPrismaClient();
  const data = dbPatchFromEventPatch(patch);
  if (step) {
    data.steps = {
      create: {
        at: new Date(),
        level: step.level || "info",
        message: step.message,
        data: step.data,
      },
    };
  }

  try {
    const event = await prisma.processingEvent.update({
      where: { id },
      data,
      include: { steps: { orderBy: [{ at: "asc" }, { id: "asc" }] } },
    });
    return eventFromDb(event);
  } catch (error) {
    if (error?.code === "P2025") return null;
    throw error;
  }
}

export async function deleteProcessingEvent(id) {
  try {
    await getPrismaClient().processingEvent.delete({ where: { id } });
    return true;
  } catch (error) {
    if (error?.code === "P2025") return false;
    throw error;
  }
}

export async function listProcessingEvents({ limit = 100 } = {}) {
  const rows = await getPrismaClient().processingEvent.findMany({
    orderBy: { receivedAt: "desc" },
    take: limit,
    include: { steps: { orderBy: [{ at: "asc" }, { id: "asc" }] } },
  });
  return rows.map(eventFromDb).map((event) => ({
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
    error_summary: eventErrorSummary(event),
    workflow_issue: eventWorkflowIssue(event),
    search: eventSearchSummary(event),
  }));
}

export async function findProcessingEventByExternalEmailId({ source, emailId }) {
  const normalizedEmailId = String(emailId || "").trim();
  if (!normalizedEmailId) return null;

  const event = await getPrismaClient().processingEvent.findFirst({
    where: {
      ...(source ? { source } : {}),
      OR: [
        { metadata: { path: ["email_id"], equals: normalizedEmailId } },
        { request: { path: ["body", "email_id"], equals: normalizedEmailId } },
        { request: { path: ["body", "message_id"], equals: normalizedEmailId } },
        { request: { path: ["body", "gmail_id"], equals: normalizedEmailId } },
      ],
    },
    orderBy: { receivedAt: "desc" },
    include: { steps: { orderBy: [{ at: "asc" }, { id: "asc" }] } },
  });
  return eventFromDb(event);
}

export async function getProcessingEvent(id) {
  const event = await getPrismaClient().processingEvent.findUnique({
    where: { id },
    include: { steps: { orderBy: [{ at: "asc" }, { id: "asc" }] } },
  });
  return eventFromDb(event);
}
