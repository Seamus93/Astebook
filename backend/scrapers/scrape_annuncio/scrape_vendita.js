import { moneyNum, pickLabelLine, pickNear, splitLines, toISODate } from "../../lib/text.js";

function extractTipoVendita(text) {
  const lines = splitLines(text);
  const v = pickLabelLine(lines, /Tipo\s+vendita/i) || pickNear(text, /Tipo\s+vendita/i, /[A-Za-zÀ-ÖØ-öø-ÿ\s]+/i, 60);
  if (!v) return null;
  const t = v.toLowerCase();
  if (/senza.*incanto/.test(t)) return "Senza incanto";
  if (/competitiva/.test(t)) return "Competitiva";
  if (/sincrona.*mista/.test(t)) return "Sincrona mista";
  if (/telematica.*asincrona/.test(t)) return "Telematica asincrona";
  return v.trim();
}

function extractOffertaMinima(text) {
  const v = pickNear(text, /Offerta\s*minima/i, /(?:€|EUR|euro)?\s*[\d\.\,]+/i, 80);
  return v ? moneyNum(v) : null;
}

function extractPrezzoBase(text) {
  const v = pickNear(text, /(?:Prezzo\s*base|Base\s*d['’]asta|prezzo\s+di\s+partenza)/i, /(?:€|EUR|euro)?\s*[\d\.\,]+/i, 100);
  return v ? moneyNum(v) : null;
}

function extractCauzione(text) {
  const amount = pickNear(text, /(?:Cauzione|Deposito\s+cauzionale)/i, /(?:€|EUR|euro)\s*[\d\.\,]+/i, 120);
  const percent = pickNear(text, /(?:Cauzione|Deposito\s+cauzionale)/i, /\d{1,2}\s*%/i, 120);
  return {
    deposito_cauzionale: amount ? moneyNum(amount) : null,
    deposito_cauzionale_percentuale: percent ? parseInt(percent, 10) : null,
  };
}

function extractDataOra(text) {
  const data = pickNear(
    text,
    /Data\s+(?:vendita|gara)/i,
    /[0-3]?\d[\/\.-][0-1]?\d[\/\.-]\d{4}|\d{1,2}\s+[A-Za-zÀ-ÖØ-öø-ÿ]+\s+\d{4}/i,
    120
  );
  const ctx = text.match(new RegExp(`(?:Data\\s+(?:vendita|gara))[\\s\\S]{0,160}`, "i"))?.[0] || "";
  const tm = ctx.match(/([01]?\d|2[0-3])[:\.]([0-5]\d)/);
  const ora = tm ? `${String(tm[1]).padStart(2, "0")}:${tm[2]}` : null;

  return { data: toISODate(data || null), ora };
}

function extractTermineDeposito(text) {
  const context =
    text.match(/(?:deposito|offert[ae]|presentazione|pervenire)[\s\S]{0,260}?(?:entro|fino\s+al|al)[\s\S]{0,140}/i)?.[0] ||
    "";
  const data = context.match(/[0-3]?\d[\/\.-][0-1]?\d[\/\.-]\d{4}|\d{1,2}\s+[A-Za-zÀ-ÖØ-öø-ÿ]+\s+\d{4}/i)?.[0] || null;
  const oraMatch = context.match(/(?:ore|h)\s*([01]?\d|2[0-3])[:\.]([0-5]\d)/i);
  return {
    data_termine_deposito: toISODate(data),
    ora_termine_deposito: oraMatch ? `${String(oraMatch[1]).padStart(2, "0")}:${oraMatch[2]}` : null,
  };
}

export function scrapeVenditaAnnuncio(text) {
  const { data, ora } = extractDataOra(text);
  const cauzione = extractCauzione(text);
  const termine = extractTermineDeposito(text);
  return {
    tipo_vendita: extractTipoVendita(text),
    data_vendita: data,
    ora_vendita: ora,
    prezzo_base: extractPrezzoBase(text),
    offerta_minima: extractOffertaMinima(text),
    deposito_cauzionale: cauzione.deposito_cauzionale,
    deposito_cauzionale_percentuale: cauzione.deposito_cauzionale_percentuale,
    data_termine_offerta: termine.data_termine_deposito,
    ora_termine_offerta: termine.ora_termine_deposito,
    data_termine_deposito: termine.data_termine_deposito,
    ora_termine_deposito: termine.ora_termine_deposito,
  };
}
