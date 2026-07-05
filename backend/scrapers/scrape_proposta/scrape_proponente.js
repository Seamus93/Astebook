import { splitLines } from "../../lib/text.js";
import { grabAfterLabel } from "./helpers.js";

export function scrapeProponente(text) {
  let nominativo = grabAfterLabel(text, [
    /il\/la\s+sottoscritt[oa]/i,
    /il\s+sottoscritto/i,
    /la\s+sottoscritta/i,
    /proponente/i,
    /sig\.?ra?\.?/i,
    /societ[aà]\s+|ditta\s+|azienda\s+/i
  ], 200);

  if (nominativo) {
    nominativo = nominativo
      .replace(/\s*(?:,|;|\bnato\b|\bnata\b|\bn\.\s*a\b|\bdomiciliat[oa]\b|\bresident[ea]\b).*$/i, "")
      .replace(/\b(?:c\.?i\.?|ci|carta d'identit[aà]|passaporto|p\.?iva|piv[ae]|codice fiscale|c\.?f\.?)\b.*$/i, "")
      .replace(/^\s*\/?\s*a\s+/i, "")
      .trim();
  }

  if (!nominativo) {
    const line = splitLines(text).find(l => /\b(sig\.?ra?|societ[aà]|ditta|azienda)\b/i.test(l));
    if (line) {
      nominativo = line
        .replace(/^.*?\b(sig\.?ra?|societ[aà]|ditta|azienda)\b[\s:,-]*/i, "")
        .replace(/\s*(?:,|;|\bnato\b|\bnata\b).*$/i, "")
        .replace(/^\s*\/?\s*a\s+/i, "")
        .trim();
    }
  }

  const telMatch = text.match(/\b(?:tel\.?|telefono)\s*[:\-]?\s*(\+?\d[\d\s\/\-]{5,})/i);
  const cellMatch = text.match(/\b(?:cell\.?|mobile)\s*[:\-]?\s*(\+?\d[\d\s\/\-]{5,})/i);
  const docMatch = text.match(/\b(?:c\.?i\.?|ci|carta d'identit[aà]|passaporto)\b.*?(?:n[°o]\s*[:\-]?\s*([A-Z0-9]{5,15}))/i);

  return {
    nominativo: nominativo || null,
    telefono: telMatch?.[1]?.trim() || null,
    cellulare: cellMatch?.[1]?.trim() || null,
    documento: docMatch?.[1]?.trim() || null,
  };
}
