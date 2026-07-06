import { parsePdfBuffer } from "../lib/pdf.js";
import { norm } from "../lib/text.js";
import { scrapeCatasto } from "./scrape_proposta/scrape_catasto.js";
import { scrapeImporti } from "./scrape_proposta/scrape_importi.js";
import { scrapeIndirizzoImmobile } from "./scrape_proposta/scrape_immobile.js";
import { scrapeProponente } from "./scrape_proposta/scrape_proponente.js";
import { scrapeTermini } from "./scrape_proposta/scrape_termini.js";

export function scrapePropostaFromText(text, fileName = "proposta.txt") {
  const T = norm(text || "");
  const importi = scrapeImporti(T);
  const termini = scrapeTermini(T);
  const catasto = scrapeCatasto(T);

  return {
    file_pdf: fileName,
    proponente: scrapeProponente(T),
    indirizzo_immobile: scrapeIndirizzoImmobile(T),
    prezzo_offerto: importi.prezzo_offerto,
    deposito_cauzionale: importi.deposito_cauzionale,
    deposito_cauzionale_percentuale: importi.deposito_cauzionale_percentuale,
    iban_beneficiario: importi.iban_beneficiario,
    irrevocabile_giorni: termini.irrevocabile_giorni,
    rogito_entro_giorni: termini.rogito_entro_giorni,
    data_termine_offerta: termini.data_termine_offerta,
    ora_termine_offerta: termini.ora_termine_offerta,
    data_termine_deposito: termini.data_termine_deposito,
    ora_termine_deposito: termini.ora_termine_deposito,
    catasto,
    catasto_voci: catasto.voci,
    raw_length: T.length
  };
}

export async function scrapePropostaFromBuffer(buffer, fileName = "proposta.pdf") {
  const { text } = await parsePdfBuffer(buffer);
  return scrapePropostaFromText(text, fileName);
}
