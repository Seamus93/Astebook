import { norm } from "../lib/text.js";

export function scrapeProvvigionePercentuale(text) {
  const T = norm(text || "");
  const patterns = [
    /(?:provvigione|proviggione|provvigioni|proviggioni|mediazione|compenso)[\s\S]{0,180}?(\d{1,2}(?:[,.]\d{1,2})?)\s*%/i,
    /(\d{1,2}(?:[,.]\d{1,2})?)\s*%[\s\S]{0,180}?(?:provvigione|proviggione|provvigioni|proviggioni|mediazione|compenso)/i,
  ];

  for (const pattern of patterns) {
    const match = T.match(pattern);
    if (!match?.[1]) continue;
    const value = Number(String(match[1]).replace(",", "."));
    if (Number.isFinite(value) && value > 0 && value <= 30) return value;
  }

  return null;
}
