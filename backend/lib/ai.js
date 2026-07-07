// lib/ai.js
import OpenAI from "openai";
import dotenv from "dotenv";
import {
  PROMPT_ANNUNCIO,
  PROMPT_INDIRIZZO,
  PROMPT_PROPOSTA,
  PROMPT_PROVVIGIONE,
} from "../ai_agents/extraction_agents.js";
dotenv.config();

const apiKey = process.env.OPENAI_API_KEY;
let openaiClient = null;

export function getOpenAIClient() {
  if (!apiKey) {
    throw new Error("OPENAI_API_KEY mancante. Imposta la variabile d'ambiente o il file .env.");
  }
  if (!openaiClient) {
    openaiClient = new OpenAI({ apiKey });
  }
  return openaiClient;
}

// taglia testo se enorme (per sicurezza token)
function clampText(t, maxChars = 120_000) {
  if (!t) return "";
  return t.length > maxChars ? t.slice(0, maxChars) : t;
}

/* ---------------- SCHEMI ---------------- */

export const schemaAnnuncio = {
  name: "AnnuncioSchema",
  schema: {
    type: "object",
    required: [
      "file_pdf","indirizzo","data_vendita","ora_vendita",
      "offerta_minima",
      "stato","aggiornato_il","ora_gara_inizio",
      "ora_gara_fine","termine_richieste_visite_data",
      "termine_richieste_visite_ora","data_termine_deposito",
      "ora_termine_deposito","descrizione","provvigione_percentuale","raw_length"
    ],
    properties: {
      file_pdf:        { type: ["string","null"] },
      indirizzo:       { type: ["string","null"] },
      data_vendita:    { type: ["string","null"] },
      ora_vendita:     { type: ["string","null"] },
      offerta_minima:  { type: ["number","null"] },
      stato:           { type: ["string","null"] },
      aggiornato_il:   { type: ["string","null"] },
      ora_gara_inizio: { type: ["string","null"] }, // HH:MM
      ora_gara_fine:   { type: ["string","null"] }, // HH:MM
      termine_richieste_visite_data: { type: ["string","null"] }, // ISO YYYY-MM-DD
      termine_richieste_visite_ora:  { type: ["string","null"] },
      data_termine_deposito: { type: ["string","null"] }, // ISO YYYY-MM-DD
      ora_termine_deposito:  { type: ["string","null"] }, // HH:MM
      descrizione:     { type: ["string","null"] },
      provvigione_percentuale: { type: ["number","null"] },
      raw_length:      { type: ["integer","null"] }
    },
    additionalProperties: false
  },
  strict: true,
};

export const schemaProposta = {
  name: "PropostaSchema",
  schema: {
    type: "object",
    required: [
      "file_pdf","proponente","indirizzo_immobile","prezzo_offerto",
      "deposito_cauzionale","cauzione_percentuale",
      "iban_beneficiario","beneficiario_cauzione","bic_cauzione",
      "irrevocabile_giorni","rogito_entro_giorni",
      "catasto","catasto_voci","luogo_redazione","data_redazione","anno_redazione",
      "raw_length",
    ],
    properties: {
      file_pdf: { type: ["string","null"] },
      proponente: {
        type: "object",
        required: ["nominativo","telefono","cellulare","documento"],
        properties: {
          nominativo: { type: ["string","null"] },
          telefono:   { type: ["string","null"] },
          cellulare:  { type: ["string","null"] },
          documento:  { type: ["string","null"] }
        },
        additionalProperties: false
      },
      indirizzo_immobile:               { type: ["string","null"] },
      prezzo_offerto:                   { type: ["number","null"] },
      deposito_cauzionale:              { type: ["number","null"] },
      cauzione_percentuale:  { type: ["integer","null"] },
      iban_beneficiario:                { type: ["string","null"] },
      beneficiario_cauzione:            { type: ["string","null"] },
      bic_cauzione:                     { type: ["string","null"] },
      irrevocabile_giorni:              { type: ["integer","null"] },
      rogito_entro_giorni:              { type: ["integer","null"] },
      catasto: {
        type: "object",
        required: ["foglio","particella","mappale","subalterno","categoria"],
        properties: {
          foglio:      { type: ["string","null"] },
          particella:  { type: ["string","null"] },
          mappale:     { type: ["string","null"] },
          subalterno:  { type: ["string","null"] },
          categoria:   { type: ["string","null"] }
        },
        additionalProperties: false
      },
      catasto_voci: {
        type: ["array","null"],
        items: {
          type: "object",
          required: ["foglio","particella","mappale","subalterno","categoria"],
          properties: {
            foglio:      { type: ["string","null"] },
            particella:  { type: ["string","null"] },
            mappale:     { type: ["string","null"] },
            subalterno:  { type: ["string","null"] },
            categoria:   { type: ["string","null"] }
          },
          additionalProperties: false
        }
      },
      luogo_redazione: { type: ["string","null"] },
      data_redazione:  { type: ["string","null"] },
      anno_redazione:  { type: ["integer","null"] },
      raw_length: { type: ["integer","null"] }
    },
    additionalProperties: false
  },
  strict: true,
};

export const schemaProvvigione = {
  name: "ProvvigioneSchema",
  schema: {
    type: "object",
    required: ["provvigione_percentuale"],
    properties: {
      provvigione_percentuale: { type: ["number","null"] },
    },
    additionalProperties: false
  },
  strict: true,
};

export const schemaIndirizzo = {
  name: "IndirizzoSchema",
  schema: {
    type: "object",
    required: [
      "indirizzo",
      "comune",
      "provincia",
      "cap",
      "quartiere",
      "municipio",
      "zona",
      "confidence",
      "note",
    ],
    properties: {
      indirizzo: { type: ["string", "null"] },
      comune: { type: ["string", "null"] },
      provincia: { type: ["string", "null"] },
      cap: { type: ["string", "null"] },
      quartiere: { type: ["string", "null"] },
      municipio: { type: ["string", "null"] },
      zona: { type: ["string", "null"] },
      confidence: { type: ["number", "null"] },
      note: { type: ["string", "null"] },
    },
    additionalProperties: false,
  },
  strict: true,
};

/* --------------- CALLERS (Responses API corretto) --------------- */

async function callJsonSchema({ prompt, content, fileName, schema }) {
  // schema: oggetto con { name, schema, strict }
  const openai = getOpenAIClient();
  const resp = await openai.responses.create({
    model: "gpt-4o-mini",
    temperature: 0,
    text: {
      format: {
        type: "json_schema",
        // <-- QUI servono questi campi a livello di format:
        name: schema.name,
        schema: schema.schema,
        strict: schema.strict ?? true,
      },
    },
    input: [
      { role: "system", content: "Restituisci solo JSON valido che rispetta lo schema." },
      { role: "user", content: `${prompt}\n\n[file_pdf=${fileName ?? "file.pdf"}]\n\n${content}` },
    ],
  });

  const raw = resp.output_text ?? "";
  let json;
  try {
    json = JSON.parse(raw);
  } catch {
    const m = raw.match(/\{[\s\S]*\}$/);
    json = m ? JSON.parse(m[0]) : {};
  }
  return json;
}

export async function aiExtractProvvigionePercentuale({ text, fileName }) {
  const content = clampText(text || "");
  const guess = preExtractAnnuncioProvvigionePercentuale(content);

  const json = await callJsonSchema({
    prompt: PROMPT_PROVVIGIONE,
    content,
    fileName: fileName || "provvigione_ocr.txt",
    schema: schemaProvvigione
  });

  json.provvigione_percentuale = normalizePercent(json.provvigione_percentuale);
  if (json.provvigione_percentuale == null) json.provvigione_percentuale = guess;

  return json;
}

export async function aiExtractIndirizzo({ address, context = "" }) {
  const content = clampText(
    [
      `indirizzo=${address || ""}`,
      context ? `contesto=${context}` : "",
    ].filter(Boolean).join("\n"),
    20_000
  );

  const json = await callJsonSchema({
    prompt: PROMPT_INDIRIZZO,
    content,
    fileName: "indirizzo.txt",
    schema: schemaIndirizzo,
  });

  if (typeof json.confidence === "number") {
    json.confidence = Math.max(0, Math.min(1, json.confidence));
  }
  if (!json.indirizzo && address) json.indirizzo = String(address).trim();
  return json;
}

export async function aiExtractProposta({ text, fileName }) {
  const content = clampText(text || "");
  const red = preExtractRedazione(content);
  const ibanGuess = preExtractIban(content);
  const catastoGuess = preExtractPropostaCatasto(content);

  const json = await callJsonSchema({
    prompt: PROMPT_PROPOSTA,
    content,
    fileName: fileName || "proposta.pdf",
    schema: schemaProposta
  });

  json.raw_length = content.length;
  if (!json.file_pdf) json.file_pdf = fileName || null;

  // Fallback ai deterministici se mancanti
  if (json.luogo_redazione == null) json.luogo_redazione = red.luogo;
  if (json.data_redazione  == null) json.data_redazione  = red.data;
  if (json.anno_redazione  == null) json.anno_redazione  = red.anno;
  if (json.iban_beneficiario == null) json.iban_beneficiario = ibanGuess;
  if (!json.catasto) json.catasto = {};
  if (json.catasto.foglio == null) json.catasto.foglio = catastoGuess.foglio;
  if (json.catasto.particella == null) json.catasto.particella = catastoGuess.particella;
  if (json.catasto.mappale == null) json.catasto.mappale = catastoGuess.mappale;
  if (json.catasto.subalterno == null) json.catasto.subalterno = catastoGuess.subalterno;
  if (json.catasto.categoria == null) json.catasto.categoria = catastoGuess.categoria;

  return json;
}

export async function aiExtractPropostaVision({ imageUrl, imageData, fileName }) {
  const payloadUrl = imageUrl || (imageData ? `data:application/pdf;base64,${imageData}` : null);
  if (!payloadUrl) return null;
  const openai = getOpenAIClient();
  const resp = await openai.responses.create({
    model: "gpt-4o-mini",
    temperature: 0,
    text: {
      format: {
        type: "json_schema",
        name: schemaProposta.name,
        schema: schemaProposta.schema,
        strict: schemaProposta.strict ?? true,
      },
    },
    input: [
      { role: "system", content: "Restituisci solo JSON valido che rispetta lo schema." },
      {
        role: "user",
        content: [
          {
            type: "input_text",
            text: `${PROMPT_PROPOSTA}\n\n[file_pdf=${fileName ?? "proposta.pdf"}]\nIl documento Ã¨ scannerizzato; leggi il contenuto dell'immagine e estrai i campi dello schema.`,
          },
          { type: "input_image", image_url: payloadUrl },
        ],
      },
    ],
  });

  const raw = resp.output_text ?? "";
  try {
    const json = JSON.parse(raw);
    json.raw_length = json.raw_length ?? null;
    if (!json.file_pdf) json.file_pdf = fileName || null;
    return json;
  } catch {
    return null;
  }
}

export async function aiExtractAnnuncio({ text, fileName }) {
  const content = clampText(text || "");
  const extras = preExtractAnnuncioGara(content);
  const provvigioneGuess = preExtractAnnuncioProvvigionePercentuale(content);
  const descrFB = preExtractAnnuncioDescrizione(content);

  const json = await callJsonSchema({
    prompt: PROMPT_ANNUNCIO,
    content,
    fileName: fileName || "annuncio.pdf",
    schema: schemaAnnuncio
  });

  json.raw_length = content.length;
  if (!json.file_pdf) json.file_pdf = fileName || null;

  // Fallback ai deterministici se mancanti
  for (const k of Object.keys(extras)) if (json[k] == null) json[k] = extras[k];
  json.provvigione_percentuale = normalizePercent(json.provvigione_percentuale);
  if (json.provvigione_percentuale == null) json.provvigione_percentuale = provvigioneGuess;
  if (json.provvigione_percentuale == null) json.provvigione_percentuale = 3;
  if (json.descrizione == null) json.descrizione = descrFB || null;

  return json;
}


function normalizePercent(val) {
  if (val === null || val === undefined) return null;
  if (typeof val === "number" && Number.isFinite(val)) {
    if (val > 0 && val < 100) return val;
    return null;
  }
  const s = String(val).trim();
  if (!s) return null;
  const m = s.match(/(\d{1,2}(?:[.,]\d{1,2})?)\s*%?/);
  if (!m) return null;
  const num = Number(m[1].replace(",", "."));
  if (!Number.isFinite(num)) return null;
  if (num > 0 && num < 100) return num;
  return null;
}

function toISODateFromIt(s) {
  if (!s) return null;
  const m = String(s).match(/\b([0-3]?\d)[\/\.\-]([0-1]?\d)[\/\.\-](\d{4})\b/);
  if (!m) return null;
  const [ , d, mo, y ] = m;
  return `${y}-${String(mo).padStart(2,"0")}-${String(d).padStart(2,"0")}`;
}

const s2 = (x)=>String(x).padStart(2,"0");

function cleanTextBlock(t) {
  // compatta spazi, rimuove spazi doppi e punti spaziati "â‚¬ 125.000, 00" -> "â‚¬ 125.000,00"
  let x = (t || "").replace(/\r/g, "");
  x = x.replace(/[ \t]+\n/g, "\n").replace(/\n{3,}/g, "\n\n");
  x = x.replace(/,\s+00\b/g, ",00"); // piccola pulizia comune negli importi
  x = x.trim();
  return x || null;
}

function preExtractRedazione(text) {
  const tail = (text || "").replace(/\r/g,"").slice(-1500); // coda documento
  const luogo = tail.match(/(?:^|\n)\s*Luogo\s*[:\-–]?\s*([^\n]+)/im)?.[1]?.trim() || null;
  const md = tail.match(/(?:^|\n)\s*Data\s*[:\-–]\s*([0-3]?\d[\/\.\-][0-1]?\d[\/\.\-]\d{4})/im);
  const dataISO = md ? toISODateFromIt(md[1]) : null;
  const anno = dataISO ? parseInt(dataISO.slice(0,4),10) : null;
  return { luogo, data: dataISO, anno };
}

function preExtractIban(text) {
  if (!text) return null;
  const m = text.match(/\bIT[0-9A-Z]{2}\s?(?:[0-9A-Z]{4}\s?){4}[0-9A-Z]{0,12}\b/i);
  if (!m) return null;
  return m[0].replace(/\s+/g, "").toUpperCase();
}

function preExtractPropostaCatasto(text) {
  const result = { foglio: null, particella: null, mappale: null, subalterno: null, categoria: null };
  if (!text) return result;
  const T = text
    .replace(/\r/g, "")
    .replace(/[_]+/g, " ")
    .replace(/[ \t]+/g, " ")
    .replace(/\n{2,}/g, "\n");

  const idx = T.search(/(identificazione\s+catastale|catasto|censito\s+al\s+n\.c\.e\.u\.|censito\s+al\s+n\.c\.t\.)/i);
  const scope = idx >= 0 ? T.slice(idx, idx + 800) : T;

  const pickFirst = (re) => scope.match(re)?.[1]?.trim() || null;
  const normalizeSub = (s) => (s ? s.replace(/\s*-\s*/g, "-").trim() : null);

  const foglio = pickFirst(/\bfoglio\b\s*[:\-]?\s*([0-9A-Za-z\/]+)/i);
  const particella = pickFirst(/\b(?:part\.?|particella|mapp\.?|mappale)\b\s*[:\-]?\s*([0-9A-Za-z\/]+)/i);
  const subalterno = normalizeSub(
    pickFirst(/\b(?:sub\.?|subalterno)\b\s*[:\-]?\s*([0-9A-Za-z\/]+(?:\s*-\s*[0-9A-Za-z\/]+)*)/i)
  );

  let categoria = null;
  const catSeg = pickFirst(/\b(?:cat\.?|categoria)\b\s*[:\-]?\s*([A-Za-z0-9\/\s\.-]{1,30})/i);
  if (catSeg) {
    const candidates = (catSeg.match(/[A-Z]{1,2}\s*\/\s*\d{1,4}|[A-Z]{1,2}\s*\d{1,4}|[A-Z]{3,5}/gi) || [])
      .map((c) => c.replace(/\s+/g, "").toUpperCase());
    if (candidates.length) {
      categoria =
        candidates.find((c) => /^[A-Z]{1,2}\/\d{1,4}$/.test(c)) ||
        candidates.find((c) => /^[A-Z]{1,2}\d{1,4}$/.test(c)) ||
        candidates[0];
    }
  }

  // fallback combinato per formati più compatti
  if (!foglio || !particella || !subalterno || !categoria) {
    const m = scope.match(
      /foglio\s*([0-9A-Za-z\/]+)[\s\S]{0,200}?(?:part\.?|particella|mapp\.?|mappale)\s*([0-9A-Za-z\/]+)[\s\S]{0,200}?(?:sub\.?|subalterno)\s*([0-9A-Za-z\/]+(?:\s*-\s*[0-9A-Za-z\/]+)*)[\s\S]{0,200}?(?:cat\.?|categoria)\s*([A-Za-z0-9\/]+)/i
    );
    if (m) {
      if (!result.foglio) result.foglio = m[1] || null;
      if (!result.particella) result.particella = m[2] || null;
      if (!result.subalterno) result.subalterno = normalizeSub(m[3]);
      if (!result.categoria) result.categoria = m[4] || null;
    }
  }

  result.foglio = foglio || result.foglio || null;
  result.particella = particella || result.particella || null;
  result.mappale = result.particella || result.mappale || null;
  result.subalterno = subalterno || result.subalterno || null;
  result.categoria = categoria || result.categoria || null;
  return result;
}

function preExtractAnnuncioGara(text) {
  const T = text || "";
  let ora_gara_inizio = null, ora_gara_fine = null;
  const m1 = T.match(/gar[ao][\s\w]{0,50}?dalle\s*([01]?\d|2[0-3])[:\.]([0-5]\d)\s*(?:alle|fino\s+alle)\s*([01]?\d|2[0-3])[:\.]([0-5]\d)/i);
  if (m1) { ora_gara_inizio = `${s2(m1[1])}:${s2(m1[2])}`; ora_gara_fine = `${s2(m1[3])}:${s2(m1[4])}`; }

  let termine_richieste_visite_data = null, termine_richieste_visite_ora = null;
  const m2 = T.match(/termine\s+richiest[ea]?\s+visite[\s\w,:]*?(?:il|entro\s+il)?\s*([0-3]?\d[\/\.\-][0-1]?\d[\/\.\-]\d{4})[\s\w,:]*?(?:ore|h)\s*([01]?\d|2[0-3])[:\.]([0-5]\d)/i);
  if (m2) { termine_richieste_visite_data = toISODateFromIt(m2[1]); termine_richieste_visite_ora = `${s2(m2[2])}:${s2(m2[3])}`; }

  return { ora_gara_inizio, ora_gara_fine, termine_richieste_visite_data, termine_richieste_visite_ora };
}

function preExtractAnnuncioProvvigionePercentuale(text) {
  if (!text) return null;
  const T = String(text).replace(/\r/g, "");
  const keyword = String.raw`\\bprovv?ig{1,2}ion[ei]\\b`;

  // "PROVVIGIONE 4%"
  const re1 = new RegExp(`${keyword}[\\s:._-]{0,20}(\\d{1,2}(?:[.,]\\d{1,2})?)\\s*%`, "i");
  const m1 = T.match(re1);
  if (m1?.[1]) return normalizePercent(m1[1]);

  // "4% PROVVIGIONE"
  const re2 = new RegExp(`(\\d{1,2}(?:[.,]\\d{1,2})?)\\s*%[\\s:._-]{0,20}${keyword}`, "i");
  const m2 = T.match(re2);
  if (m2?.[1]) return normalizePercent(m2[1]);

  return null;
}

function preExtractAnnuncioDescrizione(text) {
  if (!text) return null;
  const T = text.replace(/\r/g, "");

  // start: intestazione "Descrizione" con o senza ":" e con eventuale newline
  const startRe = /(?:^|\n)\s*Descrizione\s*:?\s*(?:\n+| )/i;
  const mStart = T.match(startRe);
  if (!mStart) return null;

  // posizione d'inizio blocco
  const startIdx = (mStart.index ?? 0) + mStart[0].length;
  const after = T.slice(startIdx);

  // stop markers (linee che tipicamente NON fanno parte della descrizione)
  const stopRe = new RegExp([
    String.raw`(?:^|\n)\s*https?:\/\/\S+`,                 // URL/â€œfonteâ€ con link
    String.raw`(?:^|\n)\s*se vuoi saperne`,                // call-to-action portale
    String.raw`(?:^|\n)\s*invia messaggio`,                // CTA
    String.raw`(?:^|\n)\s*il nostro servizio`,             // promo
    String.raw`(?:^|\n)\s*possibilita'? di mutuo`,         // promo finanziamento
    String.raw`(?:^|\n)\s*per la partecipazione`,          // info procedurali
    String.raw`(?:^|\n)\s*risparmia acquistando`,          // promo
    String.raw`(?:^|\n)\s*compera all'?asta`,              // promo
    String.raw`(?:^|\n)\s*descrizione\s*\b`,               // nuova â€œDescrizioneâ€ ripetuta (evasione ciclo)
    String.raw`(?:^|\n)\s*\d{1,2}\/\d{1,2}\/\d{2,4}[^\n]*`,// righe data/orario di portale
    String.raw`(?:^|\n)\s*\d+\/\d+\s*$`                    // paginazione "2/8"
  ].join("|"), "i");

  const mStop = after.match(stopRe);
  const rawBlock = mStop ? after.slice(0, mStop.index) : after;

  // ripulisci righe troppo promozionali finali se sfuggite
  const pruned = rawBlock
    .split("\n")
    .filter(line => !/^www\.|https?:\/\//i.test(line.trim()))
    .join("\n");

  // taglio massimo per sicurezza
  const clipped = pruned.slice(0, 4000);
  return cleanTextBlock(clipped);
}







