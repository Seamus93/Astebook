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
  const v = pickNear(text, /Offerta\s*minima/i, /(?:€|EUR)\s*[\d\.\,]+/i, 80);
  return v ? moneyNum(v) : null;
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

export function scrapeVenditaAnnuncio(text) {
  const { data, ora } = extractDataOra(text);
  return {
    tipo_vendita: extractTipoVendita(text),
    data_vendita: data,
    ora_vendita: ora,
    offerta_minima: extractOffertaMinima(text),
  };
}
