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
