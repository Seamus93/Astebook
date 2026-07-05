import { grabAmountStrict, grabPercent } from "./helpers.js";

export function scrapeImporti(text) {
  const prezzo_offerto = grabAmountStrict(text, [
    /prezzo\s+offert[oa]/i,
    /offre\s+il\s+prezzo\s+di/i,
    /offerta\s+di/i,
    /importo\s+pari\s+ad/i
  ]);

  const deposito_cauzionale = grabAmountStrict(text, [
    /deposito\s+cauzion[ae]le/i,
    /cauzion[ae]/i,
    /assegno\s+circolare/i,
    /caparra/i
  ]);

  const deposito_cauzionale_percentuale = deposito_cauzionale == null
    ? grabPercent(text, [
      /deposito\s+cauzion[ae]le/i,
      /cauzion[ae]/i,
      /caparra/i
    ])
    : null;

  const iban_beneficiario = scrapeIban(text);

  return {
    prezzo_offerto,
    deposito_cauzionale,
    deposito_cauzionale_percentuale,
    iban_beneficiario,
  };
}

export function scrapeIban(text) {
  const m = text.match(/\bIT[0-9A-Z]{2}\s?(?:[0-9A-Z]{4}\s?){5}[0-9A-Z]{3}\b/gi);
  return m ? m[0].replace(/\s+/g, "") : null;
}
