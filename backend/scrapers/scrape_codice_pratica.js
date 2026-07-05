export function normalizeCodicePratica(value) {
  if (value === null || value === undefined) return null;
  const normalized = String(value)
    .trim()
    .replace(/\s*([-_])\s*/g, "_")
    .replace(/\s+/g, "_")
    .replace(/_+/g, "_")
    .toUpperCase();
  return normalized || null;
}

export function isValidCodicePratica(value) {
  const normalized = normalizeCodicePratica(value);
  return normalized ? /^[A-Z]{2,}(?:[-_][A-Z0-9]{2,})+[-_]\d{4,}$/.test(normalized) : false;
}

export function scrapeCodicePraticaFromText(text) {
  if (!text || typeof text !== "string") return null;
  const match = text.match(/\b([A-Z]{2,}(?:\s*[-_]\s*[A-Z0-9]{2,})+\s*[-_]\s*\d{4,})\b/i) ||
    text.match(/\b([A-Z]{2,}\s+[A-Z0-9]{2,}\s+[A-Z0-9]{2,}\s+\d{4,})\b/i);
  return match ? normalizeCodicePratica(match[1]) : null;
}

export function scrapeCodicePraticaFromSubject(subject) {
  return scrapeCodicePraticaFromText(subject);
}

export function resolveCodicePraticaFromPayload(body) {
  const explicitCandidates = [
    body?.codice_pratica,
    body?.codicePratica,
    body?.practice_code,
    body?.practiceCode,
    body?.sigla,
  ];
  const firstExplicit = explicitCandidates.find((candidate) => isValidCodicePratica(candidate));
  if (firstExplicit) return normalizeCodicePratica(firstExplicit);

  return scrapeCodicePraticaFromSubject(
    [body?.subject, body?.email_subject, body?.oggetto].filter(Boolean).join(" ")
  );
}
