import { splitLines } from "../../lib/text.js";
import { grabAfterLabel } from "./helpers.js";

export function scrapeProponente(text) {
  const company = scrapeCompanyProponente(text);
  if (company) return company;

  let nominativo = grabAfterLabel(text, [
    /il\/la\s+sottoscritt[oa]/i,
    /il\s+sottoscritto/i,
    /la\s+sottoscritta/i,
    /proponente/i,
    /sig\.?ra?\.?/i,
    /societ[aà]\s+|ditta\s+|azienda\s+/i
  ], 200);

  if (nominativo) {
    nominativo = cleanNominativo(nominativo);
  }

  if (!nominativo) {
    const line = splitLines(text).find(l => /\b(sig\.?ra?|societ[aà]|ditta|azienda)\b/i.test(l));
    if (line) {
      nominativo = cleanNominativo(
        line.replace(/^.*?\b(sig\.?ra?|societ[aà]|ditta|azienda)\b[\s:,-]*/i, "")
      );
    }
  }

  const telMatch = text.match(/\b(?:tel\.?|telefono)\s*[:\-]?\s*(\+?\d[\d\s\/\-]{5,})/i);
  const cellMatch = text.match(/\b(?:cell\.?|mobile)\s*[:\-]?\s*(\+?\d[\d\s\/\-]{5,})/i);
  const docMatch = text.match(/\b(?:c\.?i\.?|ci|carta d'identit[aà]|passaporto)\b.*?(?:n[°o]\s*[:\-]?\s*([A-Z0-9]{5,15}))/i);

  return {
    nominativo: nominativo || null,
    telefono: telMatch?.[1]?.trim() || null,
    cellulare: normalizePhone(cellMatch?.[1]) || null,
    documento: docMatch?.[1]?.trim() || null,
  };
}

function scrapeCompanyProponente(text) {
  const section = extractCompanySection(text);
  if (!section) return null;

  const societa = firstMatch(section, [
    /(?:la\s+)?societ[aà]\s+(.+?)\s*,\s*con\s+sede/i,
    /(?:la\s+)?societ[aà]\s+(.+?)\s+con\s+sede/i,
  ]);
  const sede = firstMatch(section, [
    /con\s+sede\s+in\s+(.+?)\s*,\s*(?:iscritta|c\.?f\.?|p\.?\s*iva|in\s+persona)/i,
    /con\s+sede\s+(.+?)\s*,\s*(?:iscritta|c\.?f\.?|p\.?\s*iva|in\s+persona)/i,
  ]);
  const rappresentante = firstMatch(section, [
    /in\s+persona\s+del(?:la)?\s+(?:dott\.?|sig\.?|sig\.ra)?\s*([^,]+?)\s*,\s*(?:amministratore|legale|munito)/i,
    /in\s+persona\s+del(?:la)?\s+([^,]+?)\s*,\s*(?:amministratore|legale|munito)/i,
  ]);
  const ruolo = firstMatch(section, [
    /,\s*([^,]*amministratore[^,]*|[^,]*legale\s+rappresentante[^,]*)\s*,/i,
  ]);
  const codiceFiscale = firstMatch(section, [
    /\bc\.?\s*f\.?\s*(?:e\s+p\.?\s*iva\s*)?([A-Z0-9]{8,16})/i,
  ]);
  const partitaIva = firstMatch(section, [
    /\bp\.?\s*iva\s*([0-9]{8,13})/i,
  ]);
  const documento = firstMatch(section, [
    /documento\s+di\s+identit[aà]\s*\([^)]*(?:c\.?\s*i\.?|ci)[^)]*\)\s*n?\.?\s*([A-Z0-9]{5,15})/i,
    /\b(?:c\.?\s*i\.?|ci|carta\s+d'identit[aà]|passaporto)\s*n?\.?\s*([A-Z0-9]{5,15})/i,
  ]);
  const cellulare = normalizePhone(firstMatch(section, [
    /\bcell\.?\s*[\r\n\s,;:.-]*([+0-9][0-9\s\/.-]{5,})/i,
    /\bmobile\s*([+0-9][0-9\s\/.-]{5,})/i,
  ]));
  const telefono = normalizePhone(firstMatch(section, [
    /\btel\.?\s*([+0-9][0-9\s\/.-]{5,})/i,
    /\btelefono\s*([+0-9][0-9\s\/.-]{5,})/i,
  ]));

  if (!societa && !rappresentante && !cellulare && !documento) return null;

  return {
    nominativo: societa || rappresentante || null,
    societa: societa || null,
    sede: sede || null,
    rappresentante: rappresentante || null,
    ruolo: ruolo || null,
    codice_fiscale: codiceFiscale || null,
    partita_iva: partitaIva || null,
    telefono: telefono || null,
    cellulare: cellulare || null,
    documento: documento || null,
  };
}

function extractCompanySection(text) {
  const value = String(text || "");
  const start = value.search(/in\s+caso\s+di\s+societ[aà]\s*:/i);
  if (start < 0) return "";
  const section = value.slice(start);
  const stop = section.search(/(?:^|\n)\s*(?:\*{3,}|ci[oò]\s+premesso|descrizione\s+immobile|1\.\s+descrizione)/i);
  return stop > 0 ? section.slice(0, stop) : section.slice(0, 1400);
}

function firstMatch(text, patterns) {
  for (const re of patterns) {
    const match = String(text || "").match(re);
    if (match?.[1]) return match[1].replace(/\s{2,}/g, " ").trim();
  }
  return null;
}

function cleanNominativo(value) {
  return String(value || "")
    .replace(/\s*(?:,|;|\bnato\b|\bnata\b|\bn\.\s*a\b|\bdomiciliat[oa]\b|\bresident[ea]\b).*$/i, "")
    .replace(/\b(?:c\.?i\.?|ci|carta d'identit[aà]|passaporto|p\.?iva|piv[ae]|codice fiscale|c\.?f\.?)\b.*$/i, "")
    .replace(/^\s*\/?\s*a\s+/i, "")
    .trim();
}

function normalizePhone(value) {
  const clean = String(value || "").replace(/[^\d+]/g, "");
  return clean || null;
}
