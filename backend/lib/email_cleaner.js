const htmlBlockBreaks = /<\/(p|div|li|tr|h[1-6]|blockquote|section|article)>/gi;
const forwardedMarkers = [
  /--------\s*Forwarded Message\s*--------/i,
  /^-{2,}\s*Messaggio inoltrato\s*-{2,}$/i,
  /^-{2,}\s*Original Message\s*-{2,}$/i,
  /^Inizio messaggio inoltrato:/i,
  /^Messaggio inoltrato:/i,
  /^Forwarded message:/i,
  /^Original message:/i,
];

const signatureMarkers = [
  "cordiali saluti",
  "distinti saluti",
  "saluti",
  "grazie",
  "best regards",
  "kind regards",
  "un saluto",
  "in fede",
  "rimaniamo a disposizione",
  "per informazioni",
  "fammi sapere",
];

function decodeHtmlEntities(text) {
  return String(text || "")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&#(\d+);/g, (_, code) => {
      const value = Number(code);
      return Number.isFinite(value) ? String.fromCharCode(value) : " ";
    });
}

function stripHtmlNoise(html) {
  return String(html || "")
    .replace(/<head[\s\S]*?<\/head>/gi, "\n")
    .replace(/<style[\s\S]*?<\/style>/gi, "\n")
    .replace(/<script[\s\S]*?<\/script>/gi, "\n")
    .replace(/<meta[^>]*>/gi, " ")
    .replace(/<img[^>]*>/gi, " ")
    .replace(/<a\b[^>]*href=["']mailto:([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi, "$2 <$1>")
    .replace(/<a\b[^>]*>([\s\S]*?)<\/a>/gi, "$1")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(htmlBlockBreaks, "\n")
    .replace(/<[^>]+>/g, " ");
}

function normalizeLines(text) {
  return decodeHtmlEntities(text)
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n")
    .replace(/\u00a0/g, " ")
    .replace(/[ \t]+/g, " ")
    .replace(/\n[ \t]+/g, "\n")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/https?:\/\/\S+/gi, " [LINK] ")
    .replace(/\bwww\.[^\s]+/gi, " [LINK] ")
    .replace(/cid:[^\s>]+/gi, " ")
    .replace(/data-outlook-id="[^"]*"/gi, " ")
    .replace(/^\s*[>|]+\s?/gm, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function removeHeaderLikeLines(text) {
  return text
    .split("\n")
    .filter((line) => {
      const clean = line.trim();
      if (!clean) return true;
      return !/^(subject|oggetto|date|data|from|da|to|a|cc|bcc|sent|inviato|mittente)\s*:/i.test(clean);
    })
    .join("\n");
}

function cutForwardingBoilerplate(text) {
  const lines = String(text || "").split("\n");
  const output = [];
  let headerBlock = false;

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (forwardedMarkers.some((marker) => marker.test(line))) {
      headerBlock = true;
      continue;
    }

    if (headerBlock && /^(subject|oggetto|date|data|from|da|to|a|cc|bcc|sent|inviato|mittente)\s*:/i.test(line)) {
      continue;
    }

    if (headerBlock && line === "") {
      headerBlock = false;
      continue;
    }

    output.push(rawLine);
  }

  return output.join("\n");
}

function cutSignature(text) {
  const lines = String(text || "").split("\n");
  const cutoff = lines.findIndex((line) => {
    const clean = line.trim().replace(/[\.:,!\?]+$/g, "").toLowerCase();
    return signatureMarkers.some((marker) => clean === marker || clean.startsWith(`${marker} `));
  });

  return cutoff === -1 ? text : lines.slice(0, cutoff + 1).join("\n");
}

function removeCorporateSignatureTail(text) {
  const markers = [
    /^dott\.?ssa\s+/i,
    /^avvocato\b/i,
    /^responsabile divisione/i,
    /^consigliere delegato/i,
    /^tel\s*:/i,
    /^email\s*:/i,
    /^web\s*:/i,
    /^barzan[oò]|^lecco,/i,
    /^facebook$|^instagram$|^linkedin$/i,
  ];

  const lines = String(text || "").split("\n");
  const cutoff = lines.findIndex((line) => markers.some((marker) => marker.test(line.trim())));
  return cutoff === -1 ? text : lines.slice(0, cutoff).join("\n");
}

export function cleanEmailBodyForAI(rawText) {
  let text = String(rawText || "");
  if (!text.trim()) return "";

  text = stripHtmlNoise(text);
  text = normalizeLines(text);
  text = cutForwardingBoilerplate(text);
  text = removeHeaderLikeLines(text);
  text = removeCorporateSignatureTail(text);
  text = cutSignature(text);
  text = normalizeLines(text);

  return text;
}
