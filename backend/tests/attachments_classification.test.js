import assert from "node:assert/strict";
import { test } from "node:test";

import {
  classifyAttachmentDescriptor,
  describeAttachmentFile,
  refineProposalClassificationWithText,
} from "../lib/attachments.js";

test("classifies proposal template DOCX with separated basename and extension", () => {
  const descriptor = classifyAttachmentDescriptor({
    fileName: "Allegato B_Format Proposta Savoy Procedura Proprietà.docx",
    mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    buffer: Buffer.from("PK test"),
  });

  assert.equal(descriptor.basename, "Allegato B_Format Proposta Savoy Procedura Proprietà");
  assert.equal(descriptor.extension, "docx");
  assert.equal(descriptor.format, "docx");
  assert.equal(descriptor.document_type, "proposta");
  assert.equal(descriptor.document_role, "template");
  assert.equal(descriptor.proposal_candidate, false);
  assert.ok(descriptor.classification_reason.includes("filename_contains_proposta"));
  assert.ok(descriptor.classification_reason.includes("filename_contains_format"));
  assert.ok(descriptor.classification_reason.includes("docx_template_pattern"));
});

test("classifies ordinary proposal PDF as source candidate without relying only on PDF", () => {
  const descriptor = classifyAttachmentDescriptor({
    fileName: "Proposta irrevocabile di acquisto.pdf",
    mimeType: "application/pdf",
    buffer: Buffer.from("%PDF test"),
  });

  assert.equal(descriptor.extension, "pdf");
  assert.equal(descriptor.format, "pdf");
  assert.equal(descriptor.document_type, "proposta");
  assert.equal(descriptor.document_role, "source");
  assert.equal(descriptor.proposal_candidate, true);
  assert.ok(descriptor.classification_reason.includes("proposal_source_filename_pattern"));
});

test("compiled DOCX proposal can become source from content evidence", () => {
  const descriptor = classifyAttachmentDescriptor({
    fileName: "Proposta acquisto Rossi.docx",
    mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    buffer: Buffer.from("PK test"),
  });
  const refined = refineProposalClassificationWithText(
    descriptor,
    [
      "Proposta irrevocabile di acquisto",
      "Il sottoscritto Mario Rossi in qualità di Proponente Acquirente",
      "codice fiscale RSSMRA80A01H501U",
      "identificato al Catasto Fabbricati al Foglio 6, Particella 305, Sub 501",
      "Via Vicolo Magenta n. 3",
    ].join("\n")
  );

  assert.equal(refined.format, "docx");
  assert.equal(refined.document_type, "proposta");
  assert.equal(refined.document_role, "source");
  assert.equal(refined.proposal_candidate, true);
  assert.ok(refined.classification_reason.includes("content_compiled_proposal_evidence"));
});

test("template-looking PDF with empty placeholders does not become source just because it is PDF", () => {
  const descriptor = classifyAttachmentDescriptor({
    fileName: "Format Proposta.pdf",
    mimeType: "application/pdf",
    buffer: Buffer.from("%PDF test"),
  });
  const refined = refineProposalClassificationWithText(
    descriptor,
    "FORMAT PROPOSTA\nNome Cognome __________________\nCodice fiscale __________________\nDa compilare a cura del proponente."
  );

  assert.equal(refined.format, "pdf");
  assert.equal(refined.document_type, "proposta");
  assert.equal(refined.document_role, "template");
  assert.equal(refined.proposal_candidate, false);
});

test("commission collection offer document remains provvigione, not proposta", () => {
  const descriptor = classifyAttachmentDescriptor({
    fileName: "provvigione su raccolta offerte.docx",
    mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    buffer: Buffer.from("PK test"),
  });

  assert.equal(descriptor.document_type, "provvigione");
  assert.equal(descriptor.kind, "provvigione");
});

test("privacy and logo-like supporting attachments keep ignored behavior", () => {
  const privacy = classifyAttachmentDescriptor({
    fileName: "Informativa privacy cliente.pdf",
    mimeType: "application/pdf",
  });
  const logo = classifyAttachmentDescriptor({
    fileName: "Logo agenzia.png",
    mimeType: "image/png",
  });

  assert.equal(privacy.kind, "ignored");
  assert.equal(privacy.document_type, "ignored");
  assert.equal(logo.format, "png");
  assert.equal(logo.document_type, "unknown");
});

test("normalizes uppercase proposal template filename", () => {
  const descriptor = classifyAttachmentDescriptor({
    fileName: "FORMAT_PROPOSTA.DOCX",
    mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    buffer: Buffer.from("PK test"),
  });

  assert.equal(descriptor.basename, "FORMAT_PROPOSTA");
  assert.equal(descriptor.extension, "docx");
  assert.equal(descriptor.document_type, "proposta");
  assert.equal(descriptor.document_role, "template");
});

test("extracts extension from filenames with multiple dots", () => {
  const file = describeAttachmentFile("Allegato.B.Format.Proposta.v2.docx");

  assert.equal(file.basename, "Allegato.B.Format.Proposta.v2");
  assert.equal(file.extension, "docx");
});

test("diagnoses MIME extension and magic byte mismatches without trusting extension blindly", () => {
  const descriptor = classifyAttachmentDescriptor({
    fileName: "Proposta discordante.docx",
    mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    buffer: Buffer.from("%PDF really pdf"),
  });

  assert.equal(descriptor.extension, "docx");
  assert.equal(descriptor.format, "pdf");
  assert.equal(descriptor.format_detection.source, "magic");
  assert.ok(descriptor.format_detection.mismatch.includes("magic_extension_mismatch"));
  assert.ok(descriptor.format_detection.mismatch.includes("magic_mime_mismatch"));
});
