import { aiExtractAnnuncio, aiExtractCodicePratica, aiExtractProposta, aiExtractProvvigionePercentuale } from "./ai.js";
import { collectZapierAttachments, readAttachment } from "./attachments.js";
import { parseDocxBuffer } from "./docx.js";
import { fetchIbanInfo, formatMergedOutput, geocodeAddress } from "./extraction_enrichment.js";
import {
  addUniqueNote,
  buildMissingFieldsError,
  computeDataAperturaPubblicazione,
  directCodicePraticaFromPayload,
  ensureNumberDefaults,
  finalizeZapierResult,
  firstBodyValue,
  hasUsefulAnnuncioData,
  isMissingValue,
  mergeExtractedProposta,
  normalizeEmailTextForExtraction,
  replaceNullishWithEmptyString,
  resolveEmailText,
  resolvePropostaText,
  resolveProvvigioneText,
} from "./extraction_result.js";
import {
  addDaysToISODate,
  formatLocalISODate,
  shiftISOToNextBusinessDay,
  toISOFromITDate,
} from "./format_utils.js";
import { mergeAnnuncioProposta } from "./merge_json.js";
import { parsePdfBuffer } from "./pdf.js";
import { ocrFileUrlWithPdfApp } from "./pdf_app.js";

export function createAiExtractionPipeline({
  autoSendMergedDocumentEmail,
  getProcessingEvent,
  updateProcessingEvent,
}) {
  async function extractAttachmentText(resolvedAttachment, eventId, result) {
    if (resolvedAttachment.format === "docx") {
      return (await parseDocxBuffer(resolvedAttachment.buffer)).text;
    }
    if (["pdf", "image"].includes(resolvedAttachment.format)) {
      if (resolvedAttachment.url) {
        try {
          const ocrResult = await ocrFileUrlWithPdfApp({
            fileUrl: resolvedAttachment.url,
            fileName: resolvedAttachment.file_name,
          });
          if (ocrResult.ok && ocrResult.text) {
            if (eventId) {
              await updateProcessingEvent(eventId, {}, {
                message: "PDF-app OCR completed",
                data: {
                  file_name: resolvedAttachment.file_name,
                  text_length: ocrResult.text.length,
                  job_id: ocrResult.job_id || null,
                },
              });
            }
            return ocrResult.text;
          }
          if (eventId) {
            await updateProcessingEvent(eventId, {}, {
              message: "PDF-app OCR skipped or empty",
              data: {
                file_name: resolvedAttachment.file_name,
                reason: ocrResult.reason || "Nessun testo OCR restituito.",
                job_id: ocrResult.job_id || null,
              },
            });
          }
          addUniqueNote(
            result,
            `${resolvedAttachment.file_name}: OCR PDF-app non eseguito o senza testo (${ocrResult.reason || "Nessun testo OCR restituito."})`
          );
        } catch (error) {
          if (eventId) {
            await updateProcessingEvent(eventId, {}, {
              level: "error",
              message: "PDF-app OCR failed; local parser fallback",
              data: {
                file_name: resolvedAttachment.file_name,
                error: error.message || String(error),
              },
            });
          }
          addUniqueNote(
            result,
            `${resolvedAttachment.file_name}: OCR PDF-app fallito (${error.message || String(error)})`
          );
        }
      }

      if (resolvedAttachment.format === "pdf") {
        return (await parsePdfBuffer(resolvedAttachment.buffer)).text;
      }
    }
    return "";
  }

  async function extractAnnuncioAiFirst({ text, fileName, eventId, result }) {
    try {
      return await aiExtractAnnuncio({ text, fileName });
    } catch (error) {
      await updateProcessingEvent(eventId, {}, {
        level: "error",
        message: "Announcement AI extraction failed",
        data: {
          file_name: fileName,
          error: error.message || String(error),
        },
      });
      addUniqueNote(result, `${fileName}: AI annuncio fallita (${error.message || String(error)})`);
      throw error;
    }
  }

  async function extractPropostaAiFirst({ text, fileName, eventId, result }) {
    try {
      return await aiExtractProposta({ text, fileName });
    } catch (error) {
      await updateProcessingEvent(eventId, {}, {
        level: "error",
        message: "Proposal AI extraction failed",
        data: {
          file_name: fileName,
          error: error.message || String(error),
        },
      });
      addUniqueNote(result, `${fileName}: AI proposta fallita (${error.message || String(error)})`);
      throw error;
    }
  }

  async function extractProvvigioneAiFirst({ text, fileName, eventId, result }) {
    try {
      const ai = await aiExtractProvvigionePercentuale({ text, fileName });
      return typeof ai?.provvigione_percentuale === "number" ? ai.provvigione_percentuale : null;
    } catch (error) {
      await updateProcessingEvent(eventId, {}, {
        level: "error",
        message: "Commission AI extraction failed",
        data: {
          file_name: fileName,
          error: error.message || String(error),
        },
      });
      addUniqueNote(result, `${fileName}: AI provvigione fallita (${error.message || String(error)})`);
      throw error;
    }
  }

  async function extractCodicePraticaAiOnly({ text, fileName, eventId, result }) {
    if (!String(text || "").trim()) return null;
    try {
      const ai = await aiExtractCodicePratica({ text, fileName });
      return ai?.codice_pratica || null;
    } catch (error) {
      await updateProcessingEvent(eventId, {}, {
        level: "error",
        message: "Practice code AI extraction failed",
        data: {
          file_name: fileName,
          error: error.message || String(error),
        },
      });
      addUniqueNote(result, `${fileName}: AI codice pratica fallita (${error.message || String(error)})`);
      return null;
    }
  }

  async function buildMergedFromExtractionResult(result) {
    const annuncio = result.extracted?.annuncio || {};
    const proposta = result.extracted?.proposta || {};
    const provvigioneFromFile = result.extracted?.provvigione?.provvigione_percentuale;

    if (proposta.iban_beneficiario) {
      const { bic, bank } = await fetchIbanInfo(proposta.iban_beneficiario);
      if (!proposta.bic_cauzione) proposta.bic_cauzione = bic;
      if (!proposta.beneficiario_cauzione) proposta.beneficiario_cauzione = bank;
    }

    const addressCandidate = proposta.indirizzo_immobile || annuncio.indirizzo || null;
    const geocoded = await geocodeAddress(addressCandidate);

    const dataAperturaPubblicazione = computeDataAperturaPubblicazione();
    const dataRedazioneOggi = formatLocalISODate(new Date());
    const annoRedazioneOggi = new Date().getFullYear();
    const dataTermineDepositoRaw =
      annuncio.data_termine_deposito || proposta.data_termine_deposito || proposta.data_termine_offerta || null;
    const dataTermineDepositoISO = toISOFromITDate(dataTermineDepositoRaw);
    const dataGaraAnnuncioISO = toISOFromITDate(annuncio.data_vendita);
    let dataTermineDeposito = dataTermineDepositoISO || dataTermineDepositoRaw || null;
    let dataGara = null;

    if (dataTermineDepositoISO) {
      dataGara = shiftISOToNextBusinessDay(addDaysToISODate(dataTermineDepositoISO, 3));
    } else if (dataGaraAnnuncioISO) {
      dataGara = dataGaraAnnuncioISO;
      if (!dataTermineDeposito) dataTermineDeposito = addDaysToISODate(dataGaraAnnuncioISO, -3);
    }

    const provvigionePercentuale =
      typeof provvigioneFromFile === "number" && provvigioneFromFile > 0
        ? provvigioneFromFile
        : typeof annuncio.provvigione_percentuale === "number" && annuncio.provvigione_percentuale > 0
        ? annuncio.provvigione_percentuale
        : 3;
    const offertaMinima = annuncio.offerta_minima ?? annuncio.prezzo_base ?? null;

    const merged = mergeAnnuncioProposta(
      {
        file_pdf: annuncio.file_pdf,
        indirizzo: annuncio.indirizzo,
        data_vendita: annuncio.data_vendita,
        ora_vendita: annuncio.ora_vendita,
        prezzo_base: annuncio.prezzo_base,
        offerta_minima: offertaMinima,
        rilancio_minimo: annuncio.rilancio_minimo || 1000,
        offerta_minima_ammissibile:
          offertaMinima != null ? Number(offertaMinima) + 1000 : null,
        stato: annuncio.stato,
        ora_gara_inizio: annuncio.ora_gara_inizio,
        ora_gara_fine: annuncio.ora_gara_fine,
        termine_richieste_visite_data: annuncio.termine_richieste_visite_data,
        termine_richieste_visite_ora: annuncio.termine_richieste_visite_ora,
        data_termine_deposito: annuncio.data_termine_deposito,
        ora_termine_deposito: annuncio.ora_termine_deposito,
        descrizione: annuncio.descrizione,
        provvigione_percentuale: provvigionePercentuale,
      },
      {
        file_pdf: proposta.file_pdf,
        proponente: proposta.proponente,
        indirizzo_immobile: proposta.indirizzo_immobile,
        descrizione_immobile: proposta.descrizione_immobile,
        prezzo_offerto: proposta.prezzo_offerto,
        deposito_cauzionale: proposta.deposito_cauzionale,
        cauzione_percentuale: proposta.cauzione_percentuale || proposta.deposito_cauzionale_percentuale,
        iban_beneficiario: proposta.iban_beneficiario,
        bic_cauzione: proposta.bic_cauzione,
        beneficiario_cauzione: proposta.beneficiario_cauzione,
        irrevocabile_giorni: proposta.irrevocabile_giorni,
        rogito_entro_giorni: proposta.rogito_entro_giorni,
        catasto: proposta.catasto,
        luogo_redazione: proposta.luogo_redazione,
        data_redazione: proposta.data_redazione,
        anno_redazione: proposta.anno_redazione,
      }
    );

    if (geocoded) {
      if (geocoded.indirizzo) merged.immobile.indirizzo = geocoded.indirizzo;
      if (geocoded.comune) merged.immobile.comune = geocoded.comune;
      if (geocoded.cap) merged.immobile.cap = geocoded.cap;
      if (geocoded.provincia) merged.immobile.provincia = geocoded.provincia;
    }

    merged.deposito = merged.deposito || {};
    merged.deposito.data_termine_deposito = merged.deposito.data_termine_deposito ?? dataTermineDeposito;
    merged.deposito.ora_termine_deposito =
      merged.deposito.ora_termine_deposito ?? annuncio.ora_termine_deposito ?? proposta.ora_termine_deposito;
    merged.gara.data_gara = dataGara;
    merged.gara.ora_inizio = merged.gara.ora_inizio || annuncio.ora_gara_inizio || "09:00";
    merged.gara.ora_fine = merged.gara.ora_fine || annuncio.ora_gara_fine || "12:00";
    merged.data_apertura_pubblicazione = dataAperturaPubblicazione;
    merged.codice_pratica = result.codice_pratica || "";
    if (merged.redazione) {
      merged.redazione.data = dataRedazioneOggi;
      merged.redazione.anno = annoRedazioneOggi;
    }

    ensureNumberDefaults(merged.gara, ["offerta_minima", "offerta_minima_ammissibile", "rilancio_minimo"]);
    ensureNumberDefaults(merged.deposito, ["deposito_cauzionale"]);
    ensureNumberDefaults(merged.termini, ["irrevocabile_giorni", "rogito_entro_giorni"]);
    ensureNumberDefaults(merged.redazione, ["anno"]);

    formatMergedOutput(merged);
    replaceNullishWithEmptyString(merged);
    return merged;
  }

  return async function runAiExtractionPipeline({
    body = {},
    files = [],
    eventId,
    source = "zapier.email_activation",
    skipAutoSend = false,
  }) {
    const event = { id: eventId };
    const emailText = resolveEmailText(body);
    const initialCodicePratica = directCodicePraticaFromPayload(body) || "";
    const attachmentInputs = collectZapierAttachments(body, files);
    const attachments = attachmentInputs.map(({ buffer, ...safeDescriptor }) => safeDescriptor);
    const result = {
      ok: true,
      mode: "ai_extraction_pipeline",
      source,
      ready_for_zapier: false,
      codice_pratica: initialCodicePratica,
      email: {
        subject: firstBodyValue(body, ["subject", "email_subject", "oggetto"]) || null,
        from: firstBodyValue(body, ["from", "email_from", "mittente"]) || null,
        has_body_text: emailText.trim().length > 0,
      },
      attachments,
      extracted: {
        annuncio: null,
        proposta: null,
        provvigione: null,
      },
      zapier_response: null,
      notes: [],
    };

    await updateProcessingEvent(
      event.id,
      { result },
      {
        message: "Payload normalized for AI extraction",
        data: {
          attachment_count: attachments.length,
          initially_supported_count: attachments.filter((attachment) => attachment.supported_by_extraction).length,
        },
      }
    );

    const emailAnnouncementText = normalizeEmailTextForExtraction(emailText);
    result.email = result.email || {};
    result.email.original_body = String(emailText || "");
    result.email.cleaned_body = String(emailAnnouncementText || "");
    await updateProcessingEvent(event.id, { result }, { message: "Email body cleaned for AI" });
    if (!result.codice_pratica) {
      const codiceAi = await extractCodicePraticaAiOnly({
        text: [
          firstBodyValue(body, ["subject", "email_subject", "oggetto"]),
          emailAnnouncementText,
        ].filter(Boolean).join("\n"),
        fileName: "Oggetto e corpo email",
        eventId: event.id,
        result,
      });
      result.codice_pratica = codiceAi || "";
    }

    if (emailAnnouncementText) {
      const emailAnnouncement = await extractAnnuncioAiFirst({
        text: emailAnnouncementText,
        fileName: "Corpo email",
        eventId: event.id,
        result,
      });
      if (hasUsefulAnnuncioData(emailAnnouncement)) {
        result.extracted.annuncio = emailAnnouncement;
        await updateProcessingEvent(event.id, { result }, {
          message: "Email body announcement extracted",
          data: emailAnnouncement,
        });
      }
    }

    const bodyPropostaText = resolvePropostaText(body);
    if (bodyPropostaText.trim()) {
      const fileName = firstBodyValue(body, ["proposta_name", "proposta_file_name"]) || "Proposta OCR body.txt";
      const extractedProposta = await extractPropostaAiFirst({
        text: bodyPropostaText,
        fileName,
        eventId: event.id,
        result,
      });
      extractedProposta.source_format = "text";
      result.extracted.proposta = mergeExtractedProposta(result.extracted.proposta, extractedProposta);
      await updateProcessingEvent(event.id, { result }, {
        message: "Proposal body OCR extracted",
        data: extractedProposta,
      });
    }

    const bodyProvvigioneText = resolveProvvigioneText(body);
    if (bodyProvvigioneText.trim()) {
      const provvigionePercentuale = await extractProvvigioneAiFirst({
        text: bodyProvvigioneText,
        fileName: "Provvigione OCR body.txt",
        eventId: event.id,
        result,
      });
      result.extracted.provvigione = {
        file_pdf: "Provvigione OCR body.txt",
        provvigione_percentuale: provvigionePercentuale,
        raw_length: bodyProvvigioneText.length,
      };
      await updateProcessingEvent(event.id, { result }, {
        message: "Commission body OCR extracted",
        data: result.extracted.provvigione,
      });
    }

    if (attachmentInputs.length === 0 && !bodyPropostaText.trim() && !bodyProvvigioneText.trim()) {
      result.notes.push("Nessun allegato trovato nel payload ricevuto.");
      finalizeZapierResult(result);
      await updateProcessingEvent(
        event.id,
        {
          result,
          error: buildMissingFieldsError(result),
        },
        {
          message: "No supported AI extraction input found",
          data: {
            accepted_formats: [
              "application/pdf",
              "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
              "image/jpeg",
              "image/tiff",
              "image/bmp",
              "image/heic",
              "image/webp",
            ],
            received_files: attachments.map((attachment) => ({
              file_name: attachment.file_name,
              mime_type: attachment.mime_type,
            })),
          },
        }
      );
      return result;
    }

    await updateProcessingEvent(event.id, { status: "extracting" }, { message: "AI extraction started" });

    for (const attachment of attachmentInputs) {
      let resolvedAttachment = null;
      try {
        resolvedAttachment = await readAttachment(attachment);
      } catch (error) {
        result.notes.push(`${attachment.file_name}: download fallito (${error.message || String(error)})`);
        continue;
      }

      if (!resolvedAttachment?.buffer) continue;

      const safeDescriptor = {
        field_name: resolvedAttachment.field_name,
        file_name: resolvedAttachment.file_name,
        mime_type: resolvedAttachment.mime_type,
        size: resolvedAttachment.size,
        url: resolvedAttachment.url,
        kind: resolvedAttachment.kind,
        supported_by_extraction: ["pdf", "docx", "image"].includes(resolvedAttachment.format),
        format: resolvedAttachment.format,
      };
      const existingIndex = result.attachments.findIndex(
        (item) => item.url === safeDescriptor.url || item.file_name === attachment.file_name
      );
      if (existingIndex >= 0) result.attachments[existingIndex] = safeDescriptor;

      if (resolvedAttachment.kind === "ignored") continue;

      if (resolvedAttachment.format === "png") {
        addUniqueNote(result, `${resolvedAttachment.file_name}: PNG escluso da OCR e analisi AI.`);
        continue;
      }

      if (!["pdf", "docx", "image"].includes(resolvedAttachment.format)) {
        result.notes.push(`Formato non supportato: ${resolvedAttachment.file_name}`);
        continue;
      }

      try {
        if (resolvedAttachment.kind === "provvigione") {
          const attachmentText = await extractAttachmentText(resolvedAttachment, event.id, result);
          const provvigionePercentuale = await extractProvvigioneAiFirst({
            text: attachmentText,
            fileName: resolvedAttachment.file_name,
            eventId: event.id,
            result,
          });
          result.extracted.provvigione = {
            file_pdf: resolvedAttachment.file_name,
            provvigione_percentuale: provvigionePercentuale,
            raw_length: attachmentText.length,
          };
          await updateProcessingEvent(event.id, { result }, {
            message: "Commission extracted",
            data: result.extracted.provvigione,
          });
          continue;
        }

        if (resolvedAttachment.kind === "proposta") {
          const attachmentText = await extractAttachmentText(resolvedAttachment, event.id, result);
          const extractedProposta = await extractPropostaAiFirst({
            text: attachmentText,
            fileName: resolvedAttachment.file_name,
            eventId: event.id,
            result,
          });
          extractedProposta.source_format = resolvedAttachment.format;
          result.extracted.proposta = mergeExtractedProposta(result.extracted.proposta, extractedProposta);
          await updateProcessingEvent(event.id, { result }, {
            message: "Proposal extracted",
            data: extractedProposta,
          });
          continue;
        }

        if (resolvedAttachment.kind === "annuncio") {
          const attachmentText = await extractAttachmentText(resolvedAttachment, event.id, result);
          result.extracted.annuncio = await extractAnnuncioAiFirst({
            text: attachmentText,
            fileName: resolvedAttachment.file_name,
            eventId: event.id,
            result,
          });
          if (
            isMissingValue(result.extracted.annuncio.provvigione_percentuale) &&
            !isMissingValue(result.extracted.provvigione?.provvigione_percentuale)
          ) {
            result.extracted.annuncio.provvigione_percentuale = result.extracted.provvigione.provvigione_percentuale;
            result.extracted.annuncio.provvigione_source = result.extracted.provvigione.file_pdf;
          }
          if (!result.codice_pratica) {
            result.codice_pratica = await extractCodicePraticaAiOnly({
              text: attachmentText,
              fileName: resolvedAttachment.file_name,
              eventId: event.id,
              result,
            }) || "";
          }
          await updateProcessingEvent(event.id, { result }, {
            message: "Auction announcement extracted",
            data: result.extracted.annuncio,
          });
          continue;
        }
      } catch (error) {
        result.notes.push(
          `${resolvedAttachment.file_name}: estrazione fallita (${error.message || String(error)})`
        );
        continue;
      }

      result.notes.push(`Allegato non classificato: ${resolvedAttachment.file_name}`);
    }

    if (
      result.extracted.annuncio &&
      isMissingValue(result.extracted.annuncio.provvigione_percentuale) &&
      !isMissingValue(result.extracted.provvigione?.provvigione_percentuale)
    ) {
      result.extracted.annuncio.provvigione_percentuale = result.extracted.provvigione.provvigione_percentuale;
      result.extracted.annuncio.provvigione_source = result.extracted.provvigione.file_pdf;
    }

    finalizeZapierResult(result);
    result.merged = await buildMergedFromExtractionResult(result);
    result.zapier_response.merged = result.merged;
    const extractionError = buildMissingFieldsError(result);

    await updateProcessingEvent(
      event.id,
      {
        status: result.ready_for_zapier ? "completed" : "received",
        result,
        error: extractionError,
      },
      {
        message: result.ready_for_zapier
          ? "AI extraction completed"
          : "AI extraction completed with missing data",
        data: {
          ready_for_zapier: result.ready_for_zapier,
        },
      }
    );

    if (skipAutoSend) {
      result.document_email = {
        status: "skipped",
        reason: "Invio documento non richiesto dalla rielaborazione OCR/AI manuale.",
        manual: true,
      };
      await updateProcessingEvent(
        event.id,
        { result },
        { message: "Automatic document email skipped by manual OCR/AI reprocess" }
      );
    } else {
      await autoSendMergedDocumentEmail(event.id);
    }
    const finalEvent = await getProcessingEvent(event.id);

    return finalEvent?.result || result;
  };
}
