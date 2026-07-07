import { catastoCategoriaAgent } from "./catasto_categoria_agent.js";
import { catastoFoglioAgent } from "./catasto_foglio_agent.js";
import { catastoMappaleAgent } from "./catasto_mappale_agent.js";
import { catastoParticellaAgent } from "./catasto_particella_agent.js";
import { catastoSezioneAgent } from "./catasto_sezione_agent.js";
import { catastoSubalternoAgent } from "./catasto_subalterno_agent.js";
import { catastoVociAgent } from "./catasto_voci_agent.js";
import { ibanBeneficiarioAgent } from "./iban_beneficiario_agent.js";
import { irrevocabileGiorniAgent } from "./irrevocabile_giorni_agent.js";
import { prezzoOffertoAgent } from "./prezzo_offerto_agent.js";
import { propostaDataTermineDepositoAgent } from "./data_termine_deposito_agent.js";
import { propostaDataTermineOffertaAgent } from "./data_termine_offerta_agent.js";
import { propostaDepositoCauzionaleAgent } from "./deposito_cauzionale_agent.js";
import { propostaDepositoCauzionalePercentualeAgent } from "./deposito_cauzionale_percentuale_agent.js";
import { propostaIndirizzoImmobileAgent } from "./indirizzo_immobile_agent.js";
import { propostaOraTermineDepositoAgent } from "./ora_termine_deposito_agent.js";
import { propostaOraTermineOffertaAgent } from "./ora_termine_offerta_agent.js";
import { proponenteCellulareAgent } from "./proponente_cellulare_agent.js";
import { proponenteCodiceFiscaleAgent } from "./proponente_codice_fiscale_agent.js";
import { proponenteDocumentoAgent } from "./proponente_documento_agent.js";
import { proponenteNominativoAgent } from "./proponente_nominativo_agent.js";
import { proponentePartitaIvaAgent } from "./proponente_partita_iva_agent.js";
import { proponenteRappresentanteAgent } from "./proponente_rappresentante_agent.js";
import { proponenteRuoloAgent } from "./proponente_ruolo_agent.js";
import { proponenteSedeAgent } from "./proponente_sede_agent.js";
import { proponenteSocietaAgent } from "./proponente_societa_agent.js";
import { proponenteTelefonoAgent } from "./proponente_telefono_agent.js";
import { rogitoEntroGiorniAgent } from "./rogito_entro_giorni_agent.js";

export const propostaFieldAgents = {
  "proponente.nominativo": proponenteNominativoAgent,
  "proponente.societa": proponenteSocietaAgent,
  "proponente.sede": proponenteSedeAgent,
  "proponente.rappresentante": proponenteRappresentanteAgent,
  "proponente.ruolo": proponenteRuoloAgent,
  "proponente.codice_fiscale": proponenteCodiceFiscaleAgent,
  "proponente.partita_iva": proponentePartitaIvaAgent,
  "proponente.telefono": proponenteTelefonoAgent,
  "proponente.cellulare": proponenteCellulareAgent,
  "proponente.documento": proponenteDocumentoAgent,
  indirizzo_immobile: propostaIndirizzoImmobileAgent,
  prezzo_offerto: prezzoOffertoAgent,
  deposito_cauzionale: propostaDepositoCauzionaleAgent,
  deposito_cauzionale_percentuale: propostaDepositoCauzionalePercentualeAgent,
  iban_beneficiario: ibanBeneficiarioAgent,
  irrevocabile_giorni: irrevocabileGiorniAgent,
  rogito_entro_giorni: rogitoEntroGiorniAgent,
  data_termine_offerta: propostaDataTermineOffertaAgent,
  ora_termine_offerta: propostaOraTermineOffertaAgent,
  data_termine_deposito: propostaDataTermineDepositoAgent,
  ora_termine_deposito: propostaOraTermineDepositoAgent,
  "catasto.foglio": catastoFoglioAgent,
  "catasto.particella": catastoParticellaAgent,
  "catasto.mappale": catastoMappaleAgent,
  "catasto.subalterno": catastoSubalternoAgent,
  "catasto.sezione": catastoSezioneAgent,
  "catasto.categoria": catastoCategoriaAgent,
  catasto_voci: catastoVociAgent,
};
