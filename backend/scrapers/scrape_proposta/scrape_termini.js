import { toISODate } from "../../lib/text.js";
import { grabDays } from "./helpers.js";

export function scrapeTermini(text) {
  const termine = scrapeTermineOfferta(text);
  return {
    irrevocabile_giorni: grabDays(text, [
      /irrevocabil[ei]\s+dell'?\s*offerta/i,
      /l'offerta\s+rimarr[aà]\s+irrevocabile/i,
      /validit[aà]\s+dell'?\s*offerta/i
    ]),
    rogito_entro_giorni: grabDays(text, [
      /rogito\s+(?:entro|da\s+stipularsi\s+entro)/i,
      /stipula\s+entro/i
    ]),
    data_termine_offerta: termine.data,
    ora_termine_offerta: termine.ora,
    data_termine_deposito: termine.data,
    ora_termine_deposito: termine.ora,
  };
}

function scrapeTermineOfferta(text) {
  const pattern =
    /(?:offert[ae]|propost[ae]|deposito|pervenire|presentazione)[\s\S]{0,180}?(?:entro|entro\s+e\s+non\s+oltre|fino\s+al|al)\s+(?:il\s+)?([0-3]?\d[\/\.-][0-1]?\d[\/\.-]\d{4}|\d{1,2}\s+[A-Za-zÀ-ÖØ-öø-ÿ]+\s+\d{4})(?:[\s\S]{0,80}?(?:ore|h)\s*([01]?\d|2[0-3])[:\.]([0-5]\d))?/i;
  const match = String(text || "").match(pattern);
  return {
    data: toISODate(match?.[1] || null),
    ora: match?.[2] && match?.[3] ? `${String(match[2]).padStart(2, "0")}:${match[3]}` : null,
  };
}
