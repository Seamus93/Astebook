import { appendFile, mkdir, readFile, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { randomUUID } from "node:crypto";

const runtimeDir = process.env.RUNTIME_DIR || join(process.cwd(), "runtime");
const feedbackFile = process.env.EXTRACTION_FEEDBACK_FILE || join(runtimeDir, "extraction-feedback.jsonl");

function nowIso() {
  return new Date().toISOString();
}

async function ensureFeedbackFile() {
  await mkdir(runtimeDir, { recursive: true });
  if (!existsSync(feedbackFile)) {
    await writeFile(feedbackFile, "", "utf8");
  }
}

function valueAtPath(obj, path) {
  return String(path || "")
    .split(".")
    .filter(Boolean)
    .reduce((current, key) => current?.[key], obj);
}

function sourceTextExcerpt(event, sourceFile) {
  const resultEmail = event?.result?.email || {};
  const body = event?.request?.body || {};
  const sourceName = String(sourceFile || "").trim().toLowerCase();
  const candidates = [
    resultEmail.cleaned_body,
    resultEmail.original_body,
    body.email_body_text,
    body.body_plain,
    body.body_text,
    body.body,
    body.text,
  ];
  const sourceText = candidates.find((value) => String(value || "").trim());
  const clean = String(sourceText || "").replace(/\s+/g, " ").trim();
  if (!clean) return "";
  if (!sourceName) return clean.slice(0, 1000);
  const index = clean.toLowerCase().indexOf(sourceName);
  if (index === -1) return clean.slice(0, 1000);
  return clean.slice(Math.max(0, index - 300), index + sourceName.length + 700);
}

function normalizeFeedback({ event, feedback }) {
  const fieldPath = String(feedback.field_path || feedback.path || "").trim();
  if (!fieldPath) throw new Error("field_path obbligatorio.");
  const correctedValue =
    feedback.corrected_value !== undefined ? feedback.corrected_value : feedback.value;
  if (correctedValue === undefined) throw new Error("corrected_value obbligatorio.");

  const result = event?.result || {};
  const aiValue = feedback.ai_value !== undefined ? feedback.ai_value : valueAtPath(result, fieldPath);
  const sourceFile = feedback.source_file || feedback.file_name || feedback.expected_file || null;

  return {
    id: randomUUID(),
    event_id: event.id,
    source: event.source || null,
    field_path: fieldPath,
    ai_value: aiValue === undefined ? null : aiValue,
    corrected_value: correctedValue,
    rating: feedback.rating || feedback.feedback_rating || null,
    source_file: sourceFile,
    source_text_excerpt: feedback.source_text_excerpt || sourceTextExcerpt(event, sourceFile),
    reason: feedback.reason || feedback.note || "",
    model: feedback.model || process.env.AI_MODEL || null,
    prompt_version: feedback.prompt_version || process.env.EXTRACTION_PROMPT_VERSION || "default",
    created_at: nowIso(),
  };
}

export async function appendExtractionFeedback({ event, feedback }) {
  if (!event?.id) throw new Error("Evento non valido.");
  const entry = normalizeFeedback({ event, feedback });
  await ensureFeedbackFile();
  await appendFile(feedbackFile, `${JSON.stringify(entry)}\n`, "utf8");
  return entry;
}

export async function listExtractionFeedback({ limit = 200, eventId } = {}) {
  await ensureFeedbackFile();
  const raw = await readFile(feedbackFile, "utf8");
  return raw
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .flatMap((line) => {
      try {
        return [JSON.parse(line)];
      } catch (error) {
        console.error("[extraction_feedback] invalid JSONL line skipped", error);
        return [];
      }
    })
    .filter((entry) => !eventId || entry.event_id === eventId)
    .sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)))
    .slice(0, Number(limit || 200));
}

function feedbackMatchesScope(entry, scope) {
  const normalizedScope = String(scope || "").trim().toLowerCase();
  if (!normalizedScope) return true;
  const path = String(entry?.field_path || "").toLowerCase();
  if (normalizedScope === "annuncio") return path.startsWith("extracted.annuncio.");
  if (normalizedScope === "proposta") return path.startsWith("extracted.proposta.");
  if (normalizedScope === "provvigione") return path.startsWith("extracted.provvigione.");
  return path.includes(normalizedScope);
}

function scopeForFieldPath(fieldPath) {
  const path = String(fieldPath || "").toLowerCase();
  if (path.startsWith("extracted.annuncio.")) return "annuncio";
  if (path.startsWith("extracted.proposta.")) return "proposta";
  if (path.startsWith("extracted.provvigione.")) return "provvigione";
  return "altro";
}

function compactValue(value) {
  if (value === null || value === undefined) return "null";
  const text = typeof value === "string" ? value : JSON.stringify(value);
  return String(text || "").replace(/\s+/g, " ").trim().slice(0, 280);
}

export async function buildExtractionFeedbackContext({ scope, limit = 8 } = {}) {
  const entries = (await listExtractionFeedback({ limit: 500 }))
    .filter((entry) => feedbackMatchesScope(entry, scope))
    .slice(0, Number(limit || 8));

  if (!entries.length) return "";

  const examples = entries.map((entry, index) => {
    const source = entry.source_file ? ` file=${entry.source_file};` : "";
    const reason = entry.reason ? ` nota=${compactValue(entry.reason)};` : "";
    if (entry.rating === "positive") {
      return [
        `Esempio ${index + 1}:`,
        `campo=${entry.field_path};${source}`,
        `feedback=valore confermato corretto;`,
        `valore_ai=${compactValue(entry.ai_value)};${reason}`,
      ].join(" ");
    }
    if (entry.rating === "negative") {
      return [
        `Esempio ${index + 1}:`,
        `campo=${entry.field_path};${source}`,
        `feedback=valore AI rifiutato da controllo umano;`,
        `valore_ai_da_non_usare=${compactValue(entry.ai_value)};${reason}`,
      ].join(" ");
    }
    return [
      `Esempio ${index + 1}:`,
      `campo=${entry.field_path};${source}`,
      `valore_ai=${compactValue(entry.ai_value)};`,
      `valore_corretto=${compactValue(entry.corrected_value)};${reason}`,
    ].join(" ");
  });

  return [
    "Correzioni umane gia validate da usare come esempi di estrazione.",
    "Quando un caso simile compare nel testo, preferisci la logica del valore_corretto rispetto al valore_ai.",
    "Non copiare valori se non sono presenti nel nuovo documento.",
    ...examples,
  ].join("\n");
}

export async function summarizeExtractionFeedback({ limit = 500 } = {}) {
  const entries = await listExtractionFeedback({ limit });
  const byScope = {};
  const byField = {};
  const byReason = {};

  entries.forEach((entry) => {
    const scope = scopeForFieldPath(entry.field_path);
    byScope[scope] = (byScope[scope] || 0) + 1;
    byField[entry.field_path] = (byField[entry.field_path] || 0) + 1;
    const reason = String(entry.reason || "Senza motivo").trim() || "Senza motivo";
    byReason[reason] = (byReason[reason] || 0) + 1;
  });

  const sortCountEntries = (values, max = 12) =>
    Object.entries(values)
      .map(([key, count]) => ({ key, count }))
      .sort((a, b) => b.count - a.count || a.key.localeCompare(b.key))
      .slice(0, max);

  return {
    total: entries.length,
    by_scope: sortCountEntries(byScope),
    top_fields: sortCountEntries(byField),
    top_reasons: sortCountEntries(byReason, 8),
    recent: entries.slice(0, 10).map((entry) => ({
      id: entry.id,
      event_id: entry.event_id,
      field_path: entry.field_path,
      corrected_value: entry.corrected_value,
      ai_value: entry.ai_value,
      source_file: entry.source_file,
      reason: entry.reason,
      created_at: entry.created_at,
    })),
  };
}
