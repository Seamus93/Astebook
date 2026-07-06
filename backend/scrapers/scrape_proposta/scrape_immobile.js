export function scrapeIndirizzoImmobile(text) {
  const addrCore =
    `(via|viale|corso|piazza|largo|vicolo|strada|piazzale|vico|borgo)` +
    `\\s+[A-Za-zÀ-ÖØ-öø-ÿ'’.\\- ]+\\s*(?:,|n\\.?|num\\.?|numero)?\\s*\\d+[A-Z]?`;
  const contextualPatterns = [
    new RegExp(`(?:immobile|bene|lotto)\\s+(?:sito|posto|in)\\s+(${addrCore}.*?)(?:\\n|$|\\.|,)`, "i"),
    new RegExp(`(?:oggetto\\s+dell'?offerta|ad\\s+oggetto)\\s+(${addrCore}.*?)(?:\\n|$|\\.|,)`, "i"),
  ];

  for (const re of contextualPatterns) {
    const m = text.match(re);
    if (m?.[1]) return cleanAddress(m[1]);
  }

  const candidates = collectAddressCandidates(text, addrCore);
  return candidates[0]?.address || null;
}

function cleanAddress(value) {
  return String(value || "")
    .replace(/\bn\.?\s*/i, "")
    .replace(/\bnum\.?\s*/i, "")
    .replace(/\bnumero\s*/i, "")
    .replace(/\s*,\s*/g, ", ")
    .replace(/\s{2,}/g, " ")
    .trim();
}

function collectAddressCandidates(text, addrCore) {
  const matches = Array.from(
    text.matchAll(new RegExp(`\\b(${addrCore})(?:\\s*,\\s*[A-Za-zÀ-ÖØ-öø-ÿ'’.\\- ]+)?`, "gi"))
  );

  return matches
    .map((match, index) => {
      const address = cleanAddress(match[1]);
      const start = match.index || 0;
      const context = text.slice(
        Math.max(0, start - 280),
        Math.min(text.length, start + match[0].length + 280)
      );
      return {
        address,
        index,
        score: scoreAddressContext(context, address),
      };
    })
    .filter((candidate) => candidate.address)
    .sort((a, b) => b.score - a.score || a.index - b.index);
}

function scoreAddressContext(context, address) {
  const c = String(context || "").toLowerCase();
  let score = 0;

  if (/\b(immobile|bene|lotto|unit[aà]\s+immobiliare|fabbricato)\b/.test(c)) score += 8;
  if (/\b(catasto|catastale|foglio|particella|mappale|subalterno)\b/.test(c)) score += 6;
  if (/\b(oggetto|offerta|proposta|acquisto|vendita)\b/.test(c)) score += 3;
  if (/\b(comune|ubicat[oa]|sito|posta|posto)\b/.test(c)) score += 2;

  if (/\b(iban|beneficiario|bonifico|cauzione|conto\s+corrente|intestat[oa])\b/.test(c)) score -= 8;
  if (/\b(sede|azienda|societ[aà]|venditore|proponente\s+venditore|i-?resales|astebook)\b/.test(c)) score -= 5;
  if (/\b(allegare|documento|privacy|aml|codice\s+fiscale)\b/.test(c)) score -= 2;

  if (/\balfieri\b/i.test(address) && /\b(iban|beneficiario|sede|societ[aà]|i-?resales|astebook)\b/.test(c)) {
    score -= 6;
  }

  return score;
}
