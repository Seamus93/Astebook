import { norm } from "../../lib/text.js";

export function scrapeCatasto(text) {
  const t = norm(text);
  const foglio = cleanCatastoValue((t.match(/\bFoglio\b\s*[:\-]?\s*([0-9A-Za-z/]+)/i) || [])[1]);
  const particella = cleanCatastoValue(
    (t.match(/\b(?:Particella|Part\.?|Mappale|Mapp\.?)\s*[:\-]?\s*([0-9A-Za-z/]+)/i) || [])[1]
  );
  const mappale = cleanCatastoValue(
    (t.match(/\b(?:Mappale|Mapp\.?)\s*[:\-]?\s*([0-9A-Za-z/]+)/i) || [])[1]
  ) || particella;
  const subalterno = cleanCatastoValue(
    (t.match(/\b(?:Subalterno|Sub\.?)\s*[:\-]?\s*([0-9A-Za-z/]+)/i) || [])[1]
  );
  let sezione = cleanCatastoValue((t.match(/\bSezione\b\s*[:\-]?\s*([A-Z0-9]{1,3})/i) || [])[1]);
  if (sezione && /^[0-9]+$/.test(sezione)) sezione = null;
  const categoria = cleanCategoria((t.match(/\b(?:Cat\.?|Categoria)\s*[:\-]?\s*([A-Z][0-9]?(?:\/[0-9]+)?)/i) || [])[1]);
  return { foglio, particella, mappale, subalterno, sezione, categoria };
}

function cleanCatastoValue(value) {
  const clean = String(value || "").trim().replace(/[.,;:)]+$/g, "");
  return clean || null;
}

function cleanCategoria(value) {
  const clean = String(value || "").trim().replace(/[.,;:)]+$/g, "").toUpperCase();
  return clean || null;
}
