import { norm, splitLines } from "../../lib/text.js";

export function scrapeCatasto(text) {
  const t = norm(text);
  const voci = scrapeCatastoVoci(t);
  const first = voci[0] || fallbackCatasto(t);

  return {
    foglio: first.foglio || null,
    particella: first.particella || first.mappale || null,
    mappale: first.mappale || first.particella || null,
    subalterno: first.subalterno || null,
    sezione: first.sezione || null,
    categoria: first.categoria || null,
    voci,
  };
}

function scrapeCatastoVoci(text) {
  const voci = [];
  const lines = splitLines(text);

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    if (!/\bfoglio\b/i.test(line)) continue;

    const current = normalizeVoce({
      foglio: pick(line, /\bfoglio\b\s*[:\-]?\s*([0-9][0-9A-Za-z/]*)/i),
      particella: pick(line, /\b(?:particella|part\.?|mappale|mapp\.?)\s*[:\-]?\s*([0-9][0-9A-Za-z/]*)/i),
      mappale: pick(line, /\b(?:mappale|mapp\.?)\s*[:\-]?\s*([0-9][0-9A-Za-z/]*)/i),
      subalterno: pick(line, /\b(?:subalterno|sub\.?)\s*[:\-]?\s*([0-9][0-9A-Za-z/]*)/i),
      sezione: pick(line, /\bsezione\b\s*[:\-]?\s*([A-Z0-9]{1,3})/i),
      categoria: pick(line, /\b(?:categoria|cat\.|cat\b)\s*[:\-]?\s*([A-Z][0-9]?(?:\/[0-9]+)?)/i),
    });

    addUniqueVoce(voci, current);
  }

  return voci;
}

function fallbackCatasto(text) {
  return normalizeVoce({
    foglio: pick(text, /\bfoglio\b\s*[:\-]?\s*([0-9][0-9A-Za-z/]*)/i),
    particella: pick(text, /\b(?:particella|part\.?|mappale|mapp\.?)\s*[:\-]?\s*([0-9][0-9A-Za-z/]*)/i),
    mappale: pick(text, /\b(?:mappale|mapp\.?)\s*[:\-]?\s*([0-9][0-9A-Za-z/]*)/i),
    subalterno: pick(text, /\b(?:subalterno|sub\.?)\s*[:\-]?\s*([0-9][0-9A-Za-z/]*)/i),
    sezione: pick(text, /\bsezione\b\s*[:\-]?\s*([A-Z0-9]{1,3})/i),
    categoria: pick(text, /\b(?:categoria|cat\.|cat\b)\s*[:\-]?\s*([A-Z][0-9]?(?:\/[0-9]+)?)/i),
  });
}

function pick(text, re) {
  return (String(text || "").match(re) || [])[1] || null;
}

function normalizeVoce(voce) {
  const normalized = {
    foglio: cleanCatastoValue(voce.foglio),
    particella: cleanCatastoValue(voce.particella),
    mappale: cleanCatastoValue(voce.mappale || voce.particella),
    subalterno: cleanCatastoValue(voce.subalterno),
    sezione: cleanCatastoValue(voce.sezione),
    categoria: cleanCategoria(voce.categoria),
  };
  if (normalized.sezione && /^[0-9]+$/.test(normalized.sezione)) normalized.sezione = null;
  return normalized;
}

function cleanCatastoValue(value) {
  const clean = String(value || "").trim().replace(/[.,;:)]+$/g, "");
  return clean || null;
}

function cleanCategoria(value) {
  const clean = String(value || "").trim().replace(/[.,;:)]+$/g, "").toUpperCase();
  return clean || null;
}

function hasCatastoValue(voce) {
  return Boolean(voce.foglio || voce.particella || voce.mappale || voce.subalterno || voce.sezione || voce.categoria);
}

function addUniqueVoce(voci, voce) {
  if (!hasCatastoValue(voce)) return;
  const key = [voce.foglio, voce.mappale || voce.particella, voce.subalterno, voce.sezione, voce.categoria]
    .map((value) => String(value || "").trim().toLowerCase())
    .join("|");
  const exists = voci.some(
    (item) =>
      [item.foglio, item.mappale || item.particella, item.subalterno, item.sezione, item.categoria]
        .map((value) => String(value || "").trim().toLowerCase())
        .join("|") === key
  );
  if (!exists) voci.push(voce);
}
