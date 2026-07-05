import { grabDays } from "./helpers.js";

export function scrapeTermini(text) {
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
  };
}
