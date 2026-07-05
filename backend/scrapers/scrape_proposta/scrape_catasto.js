import { norm } from "../../lib/text.js";

export function scrapeCatasto(text) {
  const t = norm(text);
  const foglio = (t.match(/\bFoglio\b\s*([0-9A-Za-z]+)/i) || [])[1] || null;
  const particella = (t.match(/\b(?:Particella|Mappale|Part\.)\b\s*([0-9A-Za-z]+)/i) || [])[1] || null;
  const subalterno = (t.match(/\b(?:Subalterno|Sub)\b\s*([0-9A-Za-z]+)/i) || [])[1] || null;
  let sezione = (t.match(/\bSezione\b\s*([A-Z0-9]{1,3})/i) || [])[1] || null;
  if (sezione && /^[0-9]+$/.test(sezione)) sezione = null;
  return { foglio, particella, subalterno, sezione };
}
