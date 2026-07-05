import { splitLines } from "../../lib/text.js";

function extractIndirizzoLine(text) {
  const lines = splitLines(text);
  const addrRe = /\b(via|viale|piazza|corso|largo|vicolo|contrada|strada|piazzale|vico|borgo)\b/i;
  const clean = lines.filter(l => !/^\d{1,2}\/\d{1,2}\/\d{2,4}[,\s]/.test(l));

  const pref = clean.find(l => /all['’]asta/i.test(l) && addrRe.test(l) && /,/.test(l));
  if (pref) return pref;

  const candidates = clean.filter(l => addrRe.test(l) && (/\d/.test(l) || /,/.test(l)));
  if (candidates.length) return candidates.sort((a, b) => b.length - a.length)[0];

  return lines.find(l => /^Appartamento all'asta/i.test(l)) || null;
}

function formatAddress(via, civico, citta) {
  const parts = [];
  if (via) parts.push(via.trim());
  if (civico) parts.push(String(civico).trim());
  if (citta) parts.push(citta.replace(/\bItalia\b/gi, "").trim());
  return parts.length ? parts.join(", ") : null;
}

function buildAddressFromRaw(indirizzoRaw) {
  if (!indirizzoRaw) return null;

  let s = indirizzoRaw
    .replace(/^Appartamento all['’]asta\s*/i, "")
    .replace(/\bItalia\b/gi, "")
    .replace(/\s*-\s*/g, ", ")
    .replace(/\s*,\s*,/g, ",")
    .replace(/\s{2,}/g, " ")
    .trim();

  const patterns = [
    /(via|viale|corso|piazza|largo|vicolo|strada|piazzale|vico|borgo)\s+([A-Za-zÀ-ÖØ-öø-ÿ'’.\- ]+?)\s*,?\s*([0-9A-Z]+)\s*,?\s*(?:\b\d{5}\b\s*)?([A-Za-zÀ-ÖØ-öø-ÿ'’.\- ]+)$/i,
    /(via|viale|corso|piazza|largo|vicolo|strada|piazzale|vico|borgo)\s+([A-Za-zÀ-ÖØ-öø-ÿ'’.\- ]+?)\s*,\s*([0-9A-Z]+)\s*,?\s*(?:\b\d{5}\b\s*)?([A-Za-zÀ-ÖØ-öø-ÿ'’.\- ]+)$/i,
  ];

  for (const re of patterns) {
    const m = s.match(re);
    if (m) {
      let civico = (m[3] || "").trim();
      if (/^\d{5}$/.test(civico)) civico = null;

      let citta = (m[4] || "").trim();
      citta = citta.replace(/\b\d{5}\b/g, "").replace(/\s*,.*$/, "").trim();

      const via = `${m[1][0].toUpperCase()}${m[1].slice(1).toLowerCase()} ${m[2].trim()}`;
      return formatAddress(via, civico, citta || null);
    }
  }

  const weird = s.match(
    /(via|viale|corso|piazza|largo|vicolo|strada|piazzale|vico|borgo)\s+([A-Za-zÀ-ÖØ-öø-ÿ'’.\- ]+).*?\b(\d{5})\b\s+([A-Za-zÀ-ÖØ-öø-ÿ'’\- ]+?)\s+([0-9A-Z]+)\b/i
  );
  if (weird) {
    const via = `${weird[1][0].toUpperCase()}${weird[1].slice(1).toLowerCase()} ${weird[2].trim()}`;
    const citta = weird[4].trim().replace(/\s*,.*$/, "");
    const civico = weird[5].trim();
    return formatAddress(via, civico, citta);
  }

  const tail = s.split(",").map(t => t.trim()).filter(Boolean);
  let citta = null;
  if (tail.length >= 2) {
    citta = tail[tail.length - 1].replace(/\b\d{5}\b/g, "").trim() || null;
  }

  const mBare = s.match(/(via|viale|corso|piazza|largo|vicolo|strada|piazzale|vico|borgo)\s+([A-Za-zÀ-ÖØ-öø-ÿ'’.\- ]+)/i);
  const via = mBare ? `${mBare[1][0].toUpperCase()}${mBare[1].slice(1).toLowerCase()} ${mBare[2].trim()}` : null;

  let civico = null;
  if (via) {
    const after = s.slice(s.toLowerCase().indexOf(mBare[0].toLowerCase()) + mBare[0].length);
    const n = after.match(/\b([0-9]{1,4}[A-Z]?)\b/);
    civico = n && !/^\d{5}$/.test(n[1]) ? n[1] : null;
  }

  return formatAddress(via, civico, citta);
}

export function scrapeIndirizzoAnnuncio(text) {
  const indirizzo_raw = extractIndirizzoLine(text);
  return {
    indirizzo_raw,
    indirizzo: buildAddressFromRaw(indirizzo_raw),
  };
}
