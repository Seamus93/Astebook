import { cleanEmailBodyForAI } from "./email_cleaner.js";
import { formatLocalISODate } from "./format_utils.js";

export function ensureNumberDefaults(obj, keys) {
  keys.forEach((k) => {
    if (obj && (obj[k] === null || obj[k] === undefined)) obj[k] = 0;
  });
}

export function replaceNullishWithEmptyString(value) {
  if (value === null || value === undefined) return "";
  if (Array.isArray(value)) return value.map(replaceNullishWithEmptyString);
  if (value && typeof value === "object") {
    Object.keys(value).forEach((k) => {
      value[k] = replaceNullishWithEmptyString(value[k]);
    });
    return value;
  }
  return value;
}

export function computeDataAperturaPubblicazione() {
  const now = new Date();
  const cutoff = new Date(now);
  cutoff.setHours(15, 30, 0, 0);
  const base = now >= cutoff ? new Date(now.getTime() + 24 * 60 * 60 * 1000) : now;
  return formatLocalISODate(base);
}

export function fileByField(files, name) {
  return Array.isArray(files) ? files.find((f) => f.fieldname === name) || null : null;
}

export function firstFile(files) {
  return Array.isArray(files) && files.length > 0 ? files[0] : null;
}

export function firstBodyValue(body, keys) {
  return keys.map((key) => body?.[key]).find((value) => value !== undefined && value !== null) || "";
}

function normalizeDirectCodicePratica(value) {
  const normalized = String(value || "")
    .trim()
    .replace(/\s*([-_])\s*/g, "_")
    .replace(/\s+/g, "_")
    .replace(/_+/g, "_")
    .toUpperCase();
  return normalized || null;
}

function codicePraticaFromText(value) {
  const text = String(value || "");
  const candidates = [
    /\bTE_NOTA_\d{4,}\b/i,
    /\b[A-Z]{2,}(?:_[A-Z0-9]+){1,8}_\d{4,}\b/i,
  ];
  for (const pattern of candidates) {
    const match = text.match(pattern);
    if (match?.[0]) return normalizeDirectCodicePratica(match[0]);
  }
  return null;
}

export function directCodicePraticaFromPayload(body) {
  const explicit = normalizeDirectCodicePratica(
    firstBodyValue(body, ["codice_pratica", "codicePratica", "practice_code", "practiceCode", "sigla"])
  );
  if (explicit) return explicit;

  return codicePraticaFromText(
    firstBodyValue(body, ["subject", "email_subject", "oggetto", "title"])
  );
}

export function resolveEmailText(body) {
  return String(
    firstBodyValue(body, [
      "email_body_text",
      "body_plain",
      "body_text",
      "body",
      "text",
      "message",
      "email_body",
      "plain_body",
    ]) || ""
  );
}

export function resolvePropostaText(body) {
  return String(
    firstBodyValue(body, [
      "proposta_ocr",
      "proposta_text",
      "proposta_ocr_text",
      "ocr_text",
    ]) || ""
  );
}

export function resolveProvvigioneText(body) {
  return String(
    firstBodyValue(body, [
      "provvigione_ocr",
      "provvigione_ocr_text",
      "provvigione_text",
    ]) || ""
  );
}

export function normalizeEmailTextForExtraction(text) {
  return cleanEmailBodyForAI(text);
}

export function hasUsefulAnnuncioData(annuncio) {
  if (!annuncio) return false;
  return [
    annuncio.indirizzo,
    annuncio.indirizzo_raw,
    annuncio.tipo_vendita,
    annuncio.data_vendita,
    annuncio.ora_vendita,
    annuncio.offerta_minima,
    annuncio.provvigione_percentuale,
    annuncio.superficie_mq,
    annuncio.piano_numero,
    annuncio.ascensore,
    annuncio.stato,
    annuncio.categoria_macro,
    annuncio.aggiornato_il,
  ].some((value) => !isMissingValue(value));
}

function comparableText(value) {
  return String(value || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\b(via|viale|piazza|corso|largo|vicolo|strada|piazzale|vico|borgo)\b/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function addSourceConflictNotes(result) {
  const annuncioAddress = result.extracted?.annuncio?.indirizzo;
  const propostaAddress = result.extracted?.proposta?.indirizzo_immobile;
  if (
    !isMissingValue(annuncioAddress) &&
    !isMissingValue(propostaAddress) &&
    comparableText(annuncioAddress) !== comparableText(propostaAddress)
  ) {
    addUniqueNote(
      result,
      `Conflitto indirizzo: Annuncio "${annuncioAddress}" diverso da Proposta "${propostaAddress}".`
    );
  }
}

function propostaSourcePriority(proposta) {
  const source = String(proposta?.source_format || proposta?.file_pdf || "").toLowerCase();
  if (/pdf|image|png|jpe?g|tiff?|bmp|heic/.test(source)) return 20;
  if (/docx|document/.test(source)) return 10;
  return 0;
}

export function mergeExtractedProposta(current, next) {
  if (!current) return next;
  if (!next) return current;

  const currentPriority = propostaSourcePriority(current);
  const nextPriority = propostaSourcePriority(next);
  const nextWins = nextPriority > currentPriority;
  const merged = {
    ...current,
    proponente: {
      ...(current.proponente || {}),
    },
    catasto: {
      ...(current.catasto || {}),
    },
    source_files: Array.from(
      new Set([...(current.source_files || [current.file_pdf]).filter(Boolean), next.file_pdf].filter(Boolean))
    ),
    raw_length: Math.max(Number(current.raw_length || 0), Number(next.raw_length || 0)),
  };
  if (nextWins) {
    merged.file_pdf = next.file_pdf || merged.file_pdf;
    merged.source_format = next.source_format || merged.source_format;
  }
  const currentVoci = Array.isArray(current.catasto_voci)
    ? current.catasto_voci
    : Array.isArray(current.catasto?.voci)
    ? current.catasto.voci
    : [];
  const nextVoci = Array.isArray(next.catasto_voci)
    ? next.catasto_voci
    : Array.isArray(next.catasto?.voci)
    ? next.catasto.voci
    : [];
  const mergedVoci = nextWins
    ? mergeCatastoVoci(nextVoci, currentVoci)
    : mergeCatastoVoci(currentVoci, nextVoci);
  if (mergedVoci.length) {
    merged.catasto.voci = mergedVoci;
    merged.catasto_voci = mergedVoci;
  }

  const mergeValue = (key) => {
    if (!isMissingValue(next[key]) && (isMissingValue(merged[key]) || nextWins)) merged[key] = next[key];
  };
  const mergeNestedValue = (parent, key) => {
    if (!isMissingValue(next[parent]?.[key]) && (isMissingValue(merged[parent]?.[key]) || nextWins)) {
      merged[parent] = { ...(merged[parent] || {}), [key]: next[parent][key] };
    }
  };

  [
    "indirizzo_immobile",
    "prezzo_offerto",
    "deposito_cauzionale",
    "deposito_cauzionale_percentuale",
    "iban_beneficiario",
    "irrevocabile_giorni",
    "rogito_entro_giorni",
    "data_termine_offerta",
    "ora_termine_offerta",
    "data_termine_deposito",
    "ora_termine_deposito",
  ].forEach(mergeValue);
  ["nominativo", "telefono", "cellulare", "documento"].forEach((key) => mergeNestedValue("proponente", key));
  ["foglio", "particella", "subalterno", "sezione", "categoria"].forEach((key) => mergeNestedValue("catasto", key));

  return merged;
}

function mergeCatastoVoci(primary = [], fallback = []) {
  const merged = [];
  const add = (voce) => {
    if (!voce || typeof voce !== "object") return;
    const key = [voce.foglio, voce.mappale || voce.particella, voce.subalterno, voce.sezione, voce.categoria]
      .map((value) => String(value || "").trim().toLowerCase())
      .join("|");
    if (!key.replace(/\|/g, "")) return;
    if (!merged.some((item) => item.key === key)) merged.push({ key, voce });
  };
  primary.forEach(add);
  fallback.forEach(add);
  return merged.map((item) => item.voce);
}

export function finalizeZapierResult(result) {
  addSourceConflictNotes(result);
  result.missing_fields = collectMissingFields(result);
  result.ready_for_zapier =
    Boolean(result.extracted.annuncio || result.extracted.proposta) && result.missing_fields.length === 0;
  result.zapier_response = {
    ok: result.ready_for_zapier,
    codice_pratica: result.codice_pratica,
    annuncio: result.extracted.annuncio,
    proposta: result.extracted.proposta,
  };
  return result;
}

export function isMissingValue(value) {
  if (value === null || value === undefined) return true;
  if (typeof value === "string") {
    const clean = value.trim();
    return !clean || clean === "-" || /^[…._\s”")/]+$/.test(clean);
  }
  return false;
}

function valueAtPath(obj, path) {
  return path.split(".").reduce((current, key) => current?.[key], obj);
}

const expectedZapierFields = [
  { path: "codice_pratica", label: "Codice Pratica", expected_file: "Oggetto mail o Annuncio" },
  { path: "extracted.proposta.proponente.nominativo", label: "Proponente - Nominativo", expected_file: "Proposta" },
  { path: "extracted.proposta.indirizzo_immobile", label: "Indirizzo Immobile", expected_file: "Proposta" },
  { path: "extracted.proposta.prezzo_offerto", label: "Prezzo Offerto", expected_file: "Proposta" },
  { path: "extracted.proposta.iban_beneficiario", label: "IBAN Beneficiario", expected_file: "Proposta" },
  { path: "extracted.proposta.catasto.foglio", label: "Catasto - Foglio", expected_file: "Proposta o Visura" },
  { path: "extracted.proposta.catasto.particella", label: "Catasto - Particella", expected_file: "Proposta o Visura" },
  { path: "extracted.proposta.catasto.subalterno", label: "Catasto - Subalterno", expected_file: "Proposta o Visura" },
  { path: "extracted.annuncio.indirizzo", label: "Annuncio - Indirizzo", expected_file: "Annuncio" },
  { path: "extracted.annuncio.offerta_minima", label: "Offerta Minima", expected_file: "Annuncio" },
  { path: "extracted.annuncio.data_vendita", label: "Data Vendita", expected_file: "Annuncio" },
  { path: "extracted.annuncio.ora_vendita", label: "Ora Vendita", expected_file: "Annuncio" },
];

function collectMissingFields(result) {
  return expectedZapierFields
    .filter((field) => isMissingValue(valueAtPath(result, field.path)))
    .map((field) => ({
      field: field.label,
      message: `${field.label}: Dato non trovato o mancante. (Expected File ${field.expected_file})`,
      expected_file: field.expected_file,
      path: field.path,
    }));
}

export function buildMissingFieldsError(result) {
  const missingFields = collectMissingFields(result);
  if (missingFields.length === 0) return null;
  return {
    message: "Dati mancanti rilevati durante l'estrazione.",
    missing_fields: missingFields,
  };
}

export function addUniqueNote(result, note) {
  if (!note) return;
  result.notes = Array.isArray(result.notes) ? result.notes : [];
  if (!result.notes.includes(note)) result.notes.push(note);
}
