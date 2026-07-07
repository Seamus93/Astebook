import { createFieldAgent } from "../create_field_agent.js";

export const ibanBeneficiarioAgent = createFieldAgent({
  id: "proposta_iban_beneficiario_extractor",
  scope: "proposta",
  field: "iban_beneficiario",
  description: "IBAN beneficiario per cauzione/deposito.",
  output: '{ "iban_beneficiario": string | null }',
  hints: ["Estrai solo IBAN italiano che inizia con IT.", "Rimuovi spazi interni."],
});
