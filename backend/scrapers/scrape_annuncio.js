import { parsePdfBuffer } from "../lib/pdf.js";
import { norm } from "../lib/text.js";
import { scrapeCaratteristicheAnnuncio } from "./scrape_annuncio/scrape_caratteristiche.js";
import { scrapeIndirizzoAnnuncio } from "./scrape_annuncio/scrape_indirizzo.js";
import { scrapeVenditaAnnuncio } from "./scrape_annuncio/scrape_vendita.js";
import { scrapeProvvigionePercentuale } from "./scrape_provvigione.js";

export function scrapeAnnuncioFromText(text, fileName = "annuncio.txt") {
  const T = norm(text || "");
  const indirizzo = scrapeIndirizzoAnnuncio(T);
  const vendita = scrapeVenditaAnnuncio(T);
  const caratteristiche = scrapeCaratteristicheAnnuncio(T);

  return {
    file_pdf: fileName,
    indirizzo_raw: indirizzo.indirizzo_raw,
    indirizzo: indirizzo.indirizzo,
    tipo_vendita: vendita.tipo_vendita,
    data_vendita: vendita.data_vendita,
    ora_vendita: vendita.ora_vendita,
    prezzo_base: vendita.prezzo_base,
    offerta_minima: vendita.offerta_minima,
    deposito_cauzionale: vendita.deposito_cauzionale,
    deposito_cauzionale_percentuale: vendita.deposito_cauzionale_percentuale,
    data_termine_offerta: vendita.data_termine_offerta,
    ora_termine_offerta: vendita.ora_termine_offerta,
    data_termine_deposito: vendita.data_termine_deposito,
    ora_termine_deposito: vendita.ora_termine_deposito,
    provvigione_percentuale: scrapeProvvigionePercentuale(T),
    superficie_mq: caratteristiche.superficie_mq,
    piano_numero: caratteristiche.piano_numero,
    ascensore: caratteristiche.ascensore,
    stato: caratteristiche.stato,
    categoria_macro: caratteristiche.categoria_macro,
    aggiornato_il: caratteristiche.aggiornato_il,
    raw_length: T.length
  };
}

export async function scrapeAnnuncioFromBuffer(buffer, fileName = "annuncio.pdf") {
  const { text } = await parsePdfBuffer(buffer);
  return scrapeAnnuncioFromText(text, fileName);
}
