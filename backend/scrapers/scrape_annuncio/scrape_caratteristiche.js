import { moneyNum, pickLabelLine, pickNear, splitLines, toISODate, yesNoNormalize } from "../../lib/text.js";

function extractSuperficie(text) {
  const v = pickNear(text, /Superficie/i, /[\d\.,]+\s*m[²2]/i, 80) || pickLabelLine(splitLines(text), /Superficie/i);
  if (!v) return null;
  const n = (v.match(/([\d\.,]+)\s*m[²2]/i) || [])[1] || v.match(/([\d\.,]+)/)?.[1];
  return moneyNum(n);
}

function extractPiano(text) {
  const lines = splitLines(text);
  const v = pickLabelLine(lines, /^Piano$/i) || pickNear(text, /Piano/i, /[0-9]+/i, 30);
  const n = v && (v.match(/([0-9]+)/) || [])[1];
  return n ? parseInt(n, 10) : null;
}

function extractAscensore(text) {
  const lines = splitLines(text);
  const v = pickLabelLine(lines, /^Ascensore$/i) || pickNear(text, /Ascensore/i, /(Sì|Si|No)/i, 20);
  return yesNoNormalize(v);
}

function extractStato(text) {
  const lines = splitLines(text);
  const v = pickLabelLine(lines, /^Stato$/i) || pickNear(text, /Stato/i, /[A-Za-zÀ-ÖØ-öø-ÿ]+/i, 40);
  return v ? v.replace(/[,;]+.*/, "").trim() : null;
}

function extractCategoria(text) {
  const lines = splitLines(text);
  const v = pickLabelLine(lines, /^Categoria$/i) || pickNear(text, /Categoria/i, /[A-ZÀ-ÖØ-öø-ÿ\s]+/i, 80);
  return v ? v.toUpperCase().replace(/\s+/g, " ").trim() : null;
}

function extractAggiornatoIl(text) {
  const v = pickNear(text, /Aggiornato\s+il/i, /[0-3]?\d[\/\.-][0-1]?\d[\/\.-]\d{4}|\d{1,2}\s+[A-Za-zÀ-ÖØ-öø-ÿ]+\s+\d{4}/i, 40);
  return toISODate(v);
}

export function scrapeCaratteristicheAnnuncio(text) {
  return {
    superficie_mq: extractSuperficie(text),
    piano_numero: extractPiano(text),
    ascensore: extractAscensore(text),
    stato: extractStato(text),
    categoria_macro: extractCategoria(text),
    aggiornato_il: extractAggiornatoIl(text),
  };
}
