import { aggiornatoIlAgent } from "./aggiornato_il_agent.js";
import { annuncioDataTermineDepositoAgent } from "./data_termine_deposito_agent.js";
import { annuncioDataTermineOffertaAgent } from "./data_termine_offerta_agent.js";
import { annuncioDepositoCauzionaleAgent } from "./deposito_cauzionale_agent.js";
import { annuncioDepositoCauzionalePercentualeAgent } from "./deposito_cauzionale_percentuale_agent.js";
import { annuncioIndirizzoAgent } from "./indirizzo_agent.js";
import { annuncioOraTermineDepositoAgent } from "./ora_termine_deposito_agent.js";
import { annuncioOraTermineOffertaAgent } from "./ora_termine_offerta_agent.js";
import { ascensoreAgent } from "./ascensore_agent.js";
import { categoriaMacroAgent } from "./categoria_macro_agent.js";
import { codicePraticaAgent } from "./codice_pratica_agent.js";
import { dataVenditaAgent } from "./data_vendita_agent.js";
import { offertaMinimaAgent } from "./offerta_minima_agent.js";
import { oraVenditaAgent } from "./ora_vendita_agent.js";
import { pianoNumeroAgent } from "./piano_numero_agent.js";
import { prezzoBaseAgent } from "./prezzo_base_agent.js";
import { statoAgent } from "./stato_agent.js";
import { superficieMqAgent } from "./superficie_mq_agent.js";
import { tipoVenditaAgent } from "./tipo_vendita_agent.js";

export const annuncioFieldAgents = {
  codice_pratica: codicePraticaAgent,
  indirizzo: annuncioIndirizzoAgent,
  tipo_vendita: tipoVenditaAgent,
  data_vendita: dataVenditaAgent,
  ora_vendita: oraVenditaAgent,
  prezzo_base: prezzoBaseAgent,
  offerta_minima: offertaMinimaAgent,
  deposito_cauzionale: annuncioDepositoCauzionaleAgent,
  deposito_cauzionale_percentuale: annuncioDepositoCauzionalePercentualeAgent,
  data_termine_offerta: annuncioDataTermineOffertaAgent,
  ora_termine_offerta: annuncioOraTermineOffertaAgent,
  data_termine_deposito: annuncioDataTermineDepositoAgent,
  ora_termine_deposito: annuncioOraTermineDepositoAgent,
  superficie_mq: superficieMqAgent,
  piano_numero: pianoNumeroAgent,
  ascensore: ascensoreAgent,
  stato: statoAgent,
  categoria_macro: categoriaMacroAgent,
  aggiornato_il: aggiornatoIlAgent,
};
