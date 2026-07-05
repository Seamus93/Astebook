export function scrapeIndirizzoImmobile(text) {
  const addrCore =
    `(via|viale|corso|piazza|largo|vicolo|strada|piazzale|vico|borgo)` +
    `\\s+[A-Za-zÀ-ÖØ-öø-ÿ'’.\\- ]+\\s*,?\\s*\\d+[A-Z]?`;
  const reList = [
    new RegExp(`(?:immobile|bene|lotto)\\s+(?:sito|posto|in)\\s+(${addrCore}.*?)(?:\\n|$|\\.|,)`, "i"),
    new RegExp(`(?:oggetto\\s+dell'?offerta|ad\\s+oggetto)\\s+(${addrCore}.*?)(?:\\n|$|\\.|,)`, "i"),
    new RegExp(`\\b(${addrCore})(?:\\s*,\\s*[A-Za-zÀ-ÖØ-öø-ÿ'’.\\- ]+)?`, "i"),
  ];

  for (const re of reList) {
    const m = text.match(re);
    if (m?.[1]) return m[1].trim().replace(/\s{2,}/g, " ");
  }
  return null;
}
