import { createHash } from "node:crypto";
import { aiExtractAnnuncio, aiExtractCodicePratica, aiExtractProposta, aiExtractProvvigionePercentuale } from "./ai.js";
import { collectZapierAttachments, readAttachment, refineProposalClassificationWithText } from "./attachments.js";
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
import { createOcrInputFromBuffer, describeOcrInputUrl } from "./ocr_input_store.js";
import { ocrInputSelfTestEnabled, selfTestOcrInputUrl } from "./ocr_input_self_test.js";
import { parsePdfBuffer } from "./pdf.js";
import { ocrFileUrlWithPdfApp } from "./pdf_app.js";
import { extractImmobiliareAnnouncementUrls, scrapeImmobiliareAnnouncement } from "./immobiliare_scraper.js";

const pdfAppTextParserVersion = "pdf_app_multi_page_v1";
const inFlightOcrRequests = new Map();

export function createAiExtractionPipeline({
  autoSendMergedDocumentEmail,
  getProcessingEvent,
  updateProcessingEvent,
}) {
  const proposalDebugFields = [
    { path: "extracted.proposta.proponente.nominativo", label: "Proponente - Nominativo", aliases: ["proponente", "offerente", "nominativo", "sottoscritto"] },
    { path: "extracted.proposta.indirizzo_immobile", label: "Indirizzo Immobile", aliases: ["immobile", "indirizzo", "via", "viale", "piazza", "corso"] },
    { path: "extracted.proposta.prezzo_offerto", label: "Prezzo Offerto", aliases: ["prezzo offerto", "importo", "offerta", "euro"] },
    { path: "extracted.proposta.iban_beneficiario", label: "IBAN Beneficiario", aliases: ["iban", "beneficiario"] },
    { path: "extracted.proposta.catasto.foglio", label: "Catasto - Foglio", aliases: ["foglio", "fg"] },
    { path: "extracted.proposta.catasto.particella", label: "Catasto - Particella", aliases: ["particella", "part.", "mappale", "mapp."] },
    { path: "extracted.proposta.catasto.subalterno", label: "Catasto - Subalterno", aliases: ["subalterno", "sub."] },
  ];

  function cloneDiagnostic(value) {
    if (value === undefined) return null;
    return structuredClone(value);
  }

  function valueAtDiagnosticPath(obj, path) {
    return String(path || "")
      .split(".")
      .filter(Boolean)
      .reduce((current, key) => current?.[key], obj);
  }

  function textDiagnosticSnapshot(text, maxChars = 12000) {
    const value = String(text || "");
    if (value.length <= maxChars) {
      return {
        text: value,
        text_truncated: false,
        text_length: value.length,
      };
    }
    const chunk = Math.floor(maxChars / 2);
    return {
      text: null,
      text_truncated: true,
      text_length: value.length,
      text_head: value.slice(0, chunk),
      text_tail: value.slice(-chunk),
    };
  }

  function ensureExtractionDiagnostics(result) {
    result.extraction_diagnostics = result.extraction_diagnostics || {
      ocr_texts: [],
      proposta_agent_runs: [],
      proposta_field_matrix: [],
      attachments: [],
      proposal_selection: null,
    };
    result.extraction_diagnostics.attachments = result.extraction_diagnostics.attachments || [];
    result.extraction_diagnostics.proposal_selection ??= null;
    return result.extraction_diagnostics;
  }

  function attachmentDiagnostic(resolvedAttachment, extra = {}) {
    return {
      file_name: resolvedAttachment?.file_name || null,
      basename: resolvedAttachment?.basename || null,
      extension: resolvedAttachment?.extension || null,
      mime_type: resolvedAttachment?.mime_type || null,
      format: resolvedAttachment?.format || null,
      format_detection: resolvedAttachment?.format_detection || null,
      kind: resolvedAttachment?.kind || null,
      document_type: resolvedAttachment?.document_type || resolvedAttachment?.kind || null,
      document_role: resolvedAttachment?.document_role || null,
      native_text_length: resolvedAttachment?.text_acquisition?.native_text_length ?? null,
      ocr_required: resolvedAttachment?.text_acquisition?.ocr_required ?? null,
      ocr_attempted: resolvedAttachment?.text_acquisition?.ocr_attempted ?? null,
      ocr_status: resolvedAttachment?.text_acquisition?.ocr_status ?? null,
      ocr_attempt_count: resolvedAttachment?.text_acquisition?.ocr_attempt_count ?? null,
      ocr_attempts: resolvedAttachment?.text_acquisition?.ocr_attempts ?? null,
      ocr_text_length: resolvedAttachment?.text_acquisition?.ocr_text_length ?? null,
      text_source: resolvedAttachment?.text_acquisition?.text_source || null,
      unusable_reason: resolvedAttachment?.text_acquisition?.unusable_reason || null,
      final_error_type: resolvedAttachment?.text_acquisition?.final_error_type || null,
      template_filename_evidence: resolvedAttachment?.template_filename_evidence ?? null,
      placeholder_evidence: resolvedAttachment?.placeholder_evidence ?? null,
      compiled_value_evidence: resolvedAttachment?.compiled_value_evidence ?? null,
      classification_reason: resolvedAttachment?.classification_reason || [],
      proposal_candidate: Boolean(resolvedAttachment?.proposal_candidate),
      ...extra,
    };
  }

  function upsertAttachmentDiagnostic(result, resolvedAttachment, extra = {}) {
    const diagnostics = ensureExtractionDiagnostics(result);
    const snapshot = attachmentDiagnostic(resolvedAttachment, extra);
    const index = diagnostics.attachments.findIndex((item) =>
      (snapshot.file_name && item.file_name === snapshot.file_name) ||
      (resolvedAttachment?.url && item.url === resolvedAttachment.url)
    );
    if (index >= 0) diagnostics.attachments[index] = { ...diagnostics.attachments[index], ...snapshot };
    else diagnostics.attachments.push(snapshot);
    return snapshot;
  }

  function recordOcrTextDiagnostics(result, resolvedAttachment, text, source, transformations = []) {
    if (resolvedAttachment?.kind !== "proposta") return;
    const diagnostics = ensureExtractionDiagnostics(result);
    diagnostics.ocr_texts.push({
      file_name: resolvedAttachment.file_name,
      kind: resolvedAttachment.kind || null,
      document_type: resolvedAttachment.document_type || null,
      document_role: resolvedAttachment.document_role || null,
      source,
      format: resolvedAttachment.format || null,
      text_length: String(text || "").length,
      text: textDiagnosticSnapshot(text),
      transformations,
    });
  }

  function fieldPresentInOcr(text, aliases = []) {
    const normalized = String(text || "").toLowerCase();
    return aliases.some((alias) => normalized.includes(String(alias).toLowerCase()));
  }

  function classifyProposalLoss({ ocrPresent, agentValue, mergedValue, finalValue, finalMissing }) {
    if (!ocrPresent) return "A. dato assente nel PDF oppure non riconoscibile nel testo OCR";
    if (isMissingValue(agentValue)) return "C. dato presente nel testo OCR ma non estratto dal Proposta Agent";
    if (!isMissingValue(agentValue) && isMissingValue(mergedValue)) return "D. AI lo estrae ma il merge lo perde";
    if (!isMissingValue(mergedValue) && isMissingValue(finalValue)) return "E. merge corretto ma validazione/finale lo annulla";
    if (finalMissing) return "F. campo richiesto per ready_for_zapier ma non disponibile nel finale";
    return "ok";
  }

  function buildProposalFieldMatrix({ ocrText, agentOutput, mergedResult, finalResult }) {
    const missingPaths = new Set((finalResult.missing_fields || []).map((field) => field.path));
    return proposalDebugFields.map((field) => {
      const agentPath = field.path.replace(/^extracted\.proposta\./, "");
      const agentValue = valueAtDiagnosticPath(agentOutput, agentPath);
      const mergedValue = valueAtDiagnosticPath(mergedResult, field.path);
      const finalValue = valueAtDiagnosticPath(finalResult, field.path);
      const ocrPresent = fieldPresentInOcr(ocrText, field.aliases);
      const finalMissing = missingPaths.has(field.path);
      return {
        campo: field.label,
        path: field.path,
        ocr_presente: ocrPresent,
        proposta_agent: agentValue === undefined ? null : agentValue,
        merged: mergedValue === undefined ? null : mergedValue,
        finale: finalValue === undefined ? null : finalValue,
        motivo_perdita: classifyProposalLoss({
          ocrPresent,
          agentValue,
          mergedValue,
          finalValue,
          finalMissing,
        }),
      };
    });
  }

  function finalResultDiagnosticSnapshot(result) {
    const snapshot = cloneDiagnostic({
      ready_for_zapier: result.ready_for_zapier,
      missing_fields: result.missing_fields || [],
      extracted: result.extracted || {},
      merged: result.merged || null,
      zapier_response: result.zapier_response || null,
    });
    return snapshot;
  }

  function attachmentTextCacheKey(resolvedAttachment) {
    const hash = resolvedAttachment?.buffer?.length
      ? createHash("sha256").update(resolvedAttachment.buffer).digest("hex")
      : "";
    return hash || [
      resolvedAttachment?.file_name,
      resolvedAttachment?.mime_type,
      resolvedAttachment?.size,
    ].filter(Boolean).join("|");
  }

  function cachedAttachmentText(result, resolvedAttachment) {
    const key = attachmentTextCacheKey(resolvedAttachment);
    const entry = key ? result.attachment_text_cache?.[key] : null;
    if (!entry?.text) return null;
    if (!isUsefulCachedAttachmentText(entry, resolvedAttachment.format)) return null;
    return { key, entry };
  }

  function isUsefulCachedAttachmentText(entry, format) {
    const textLength = String(entry?.text || "").trim().length;
    const normalizedFormat = String(format || entry?.format || "").toLowerCase();
    if (
      ["pdf", "image"].includes(normalizedFormat) &&
      !["pdf_app", "pdf_native"].includes(entry?.source)
    ) return false;
    if (
      ["pdf", "image"].includes(normalizedFormat) &&
      entry?.source === "pdf_app" &&
      entry?.parser_version !== pdfAppTextParserVersion
    ) {
      return false;
    }
    const minLength = ["pdf", "image"].includes(normalizedFormat) ? 500 : 1;
    return textLength >= minLength;
  }

  function normalizedAttachmentTextCache(cache) {
    if (!cache || typeof cache !== "object" || Array.isArray(cache)) return {};
    return Object.fromEntries(
      Object.entries(cache).filter(([, entry]) => isUsefulCachedAttachmentText(entry))
    );
  }

  function rememberAttachmentText(result, resolvedAttachment, text, source) {
    const cleanText = String(text || "");
    if (!cleanText.trim()) return;
    const key = attachmentTextCacheKey(resolvedAttachment);
    if (!key) return;
    const entry = {
      file_name: resolvedAttachment.file_name,
      mime_type: resolvedAttachment.mime_type || null,
      size: resolvedAttachment.size || null,
      kind: resolvedAttachment.kind || null,
      document_type: resolvedAttachment.document_type || null,
      document_role: resolvedAttachment.document_role || null,
      format: resolvedAttachment.format || null,
      text: cleanText,
      text_length: cleanText.length,
      source,
      parser_version: source === "pdf_app" ? pdfAppTextParserVersion : null,
      cached_at: new Date().toISOString(),
    };
    if (!isUsefulCachedAttachmentText(entry)) {
      delete result.attachment_text_cache?.[key];
      return;
    }
    result.attachment_text_cache = result.attachment_text_cache || {};
    result.attachment_text_cache[key] = entry;
    recordOcrTextDiagnostics(result, resolvedAttachment, cleanText, source, [
      { name: source === "pdf_app" ? "PDF-app OCR raw text" : `${source} text extraction`, changed_text: false },
    ]);
  }

  function recordOcrSummary(result, resolvedAttachment, status, data = {}) {
    result.ocr_summary = result.ocr_summary || { files: {} };
    const fileName = resolvedAttachment?.file_name || "attachment";
    const files = result.ocr_summary.files || {};
    files[fileName] = {
      ...(files[fileName] || {}),
      file_name: fileName,
      kind: resolvedAttachment?.kind || null,
      document_type: resolvedAttachment?.document_type || resolvedAttachment?.kind || null,
      document_role: resolvedAttachment?.document_role || null,
      format: resolvedAttachment?.format || null,
      status,
      ...data,
    };
    result.ocr_summary.files = files;
  }

  function ocrQualityForText(text, format) {
    const value = String(text || "");
    const cleanText = value.trim();
    const nonWhitespaceLength = cleanText.replace(/\s/g, "").length;
    if (!cleanText) {
      return {
        final_status: "ocr_empty",
        quality: "empty",
        reason: "ocr_text_empty",
        text_length: value.length,
        non_whitespace_length: nonWhitespaceLength,
      };
    }
    if (["pdf", "image"].includes(format) && nonWhitespaceLength < 100) {
      return {
        final_status: "ocr_suspicious",
        quality: "suspicious",
        reason: "ocr_text_short",
        text_length: value.length,
        non_whitespace_length: nonWhitespaceLength,
      };
    }
    return {
      final_status: "ocr_completed",
      quality: "ok",
      reason: null,
      text_length: value.length,
      non_whitespace_length: nonWhitespaceLength,
    };
  }

  function hasUsableAttachmentText(result, resolvedAttachment, text) {
    const quality = ocrQualityForText(text, resolvedAttachment.format);
    if (
      resolvedAttachment?.document_type === "proposta" &&
      ["pdf", "image"].includes(resolvedAttachment.format) &&
      quality.final_status !== "ocr_completed"
    ) {
      resolvedAttachment.text_acquisition = {
        ...(resolvedAttachment.text_acquisition || {}),
        usable_text: false,
        unusable_reason: resolvedAttachment.text_acquisition?.unusable_reason || quality.reason || "text_not_sufficient",
      };
      addUniqueNote(result, `${resolvedAttachment.file_name}: testo OCR non sufficiente per AI proposta (${resolvedAttachment.text_acquisition.unusable_reason}).`);
      return false;
    }
    if (quality.final_status !== "ocr_empty") return true;
    resolvedAttachment.text_acquisition = {
      ...(resolvedAttachment.text_acquisition || {}),
      usable_text: false,
      unusable_reason: resolvedAttachment.text_acquisition?.unusable_reason || quality.reason || "ocr_text_empty",
    };
    addUniqueNote(result, `${resolvedAttachment.file_name}: OCR completato senza testo utilizzabile; AI non avviata.`);
    return false;
  }

  function setTextAcquisition(resolvedAttachment, data = {}) {
    resolvedAttachment.text_acquisition = {
      ...(resolvedAttachment.text_acquisition || {}),
      ...data,
    };
    return resolvedAttachment.text_acquisition;
  }

  function mapOcrStatus(statusOrReason) {
    const value = String(statusOrReason || "").toLowerCase();
    if (value.includes("retry_exhausted")) return "retry_exhausted";
    if (value.includes("client_timeout") || value.includes("abort")) return "client_timeout";
    if (value.includes("http_504") || value === "504") return "http_504";
    if (value.includes("timeout")) return "client_timeout";
    if (value.includes("empty")) return "empty";
    if (value.includes("short") || value.includes("suspicious")) return "short";
    if (value.includes("completed")) return "completed";
    if (value.includes("unavailable")) return "unavailable";
    if (value.includes("failed") || value.includes("error")) return "error";
    return value || null;
  }

  function ocrUnusableReason(status) {
    if (status === "retry_exhausted") return "ocr_retry_exhausted";
    if (status === "client_timeout") return "ocr_client_timeout";
    if (status === "http_504") return "ocr_http_504";
    return "ocr_error";
  }

  async function runSingleFlightOcr(cacheKey, fn) {
    if (!cacheKey) return await fn();
    const existing = inFlightOcrRequests.get(cacheKey);
    if (existing) return await existing;
    const promise = fn().finally(() => {
      inFlightOcrRequests.delete(cacheKey);
    });
    inFlightOcrRequests.set(cacheKey, promise);
    return await promise;
  }

  function nativePdfTextSufficient(text) {
    const quality = ocrQualityForText(text, "pdf");
    return quality.final_status === "ocr_completed";
  }

  function proposalSelectionScore(candidate) {
    const compiledScore = Number(candidate.resolvedAttachment?.content_score?.compiled_value_score || candidate.resolvedAttachment?.content_score?.compiled_score || 0);
    const templateScore = Number(candidate.resolvedAttachment?.content_score?.template_score || 0);
    const placeholderScore = Number(candidate.resolvedAttachment?.content_score?.placeholder_score || 0);
    const templateFilenamePenalty = candidate.resolvedAttachment?.template_filename_evidence ? 20 : 0;
    const textLengthScore = Math.min(5, Math.floor(String(candidate.text || "").trim().length / 1500));
    return compiledScore * 15 + textLengthScore - templateScore * 5 - placeholderScore * 8 - templateFilenamePenalty;
  }

  function selectProposalCandidates(result, candidates) {
    const proposalDiagnostics = candidates.map((candidate) => ({
      ...attachmentDiagnostic(candidate.resolvedAttachment, {
        text_extracted: candidate.text_extracted,
        text_length: String(candidate.text || "").length,
        usable_text: candidate.usable_text,
        proposal_candidate: Boolean(candidate.resolvedAttachment?.proposal_candidate && candidate.usable_text),
        selection_score: proposalSelectionScore(candidate),
      }),
    }));
    const usableSources = candidates
      .filter((candidate) => candidate.usable_text && candidate.resolvedAttachment?.proposal_candidate)
      .sort((a, b) => proposalSelectionScore(b) - proposalSelectionScore(a));
    const diagnostics = ensureExtractionDiagnostics(result);

    if (!usableSources.length) {
      if (candidates.some((candidate) => candidate.resolvedAttachment?.document_role === "source")) {
        addUniqueNote(result, "Nessuna proposta source utilizzabile dopo acquisizione testo/OCR.");
      }
      diagnostics.proposal_selection = {
        status: "no_source_candidate",
        reason: "no_usable_source_candidate",
        candidates: proposalDiagnostics,
      };
      return [];
    }

    const topScore = proposalSelectionScore(usableSources[0]);
    const tied = usableSources.filter((candidate) => proposalSelectionScore(candidate) === topScore);
    const selected = usableSources;
    selected.forEach((candidate, index) => {
      candidate.proposal_primary = index === 0;
      candidate.selection_reason = index === 0 ? "compiled_proposal_candidate" : "additional_compiled_proposal_candidate";
      candidate.resolvedAttachment.proposal_primary = candidate.proposal_primary;
      candidate.resolvedAttachment.selection_reason = candidate.selection_reason;
      upsertAttachmentDiagnostic(result, candidate.resolvedAttachment, {
        text_extracted: candidate.text_extracted,
        text_length: String(candidate.text || "").length,
        usable_text: candidate.usable_text,
        proposal_primary: candidate.proposal_primary,
        selection_reason: candidate.selection_reason,
        selection_score: proposalSelectionScore(candidate),
      });
    });

    if (tied.length > 1) {
      addUniqueNote(
        result,
        `Più proposte compilate con pari priorità: ${tied.map((candidate) => candidate.resolvedAttachment.file_name).join(", ")}.`
      );
    }

    diagnostics.proposal_selection = {
      status: tied.length > 1 ? "ambiguous_sources" : "selected",
      primary_file_name: usableSources[0].resolvedAttachment.file_name,
      selection_reason: tied.length > 1 ? "ambiguous_compiled_proposal_candidates" : "compiled_proposal_candidate",
      selected_file_names: selected.map((candidate) => candidate.resolvedAttachment.file_name),
      ambiguous_file_names: tied.length > 1 ? tied.map((candidate) => candidate.resolvedAttachment.file_name) : [],
      candidates: proposalDiagnostics.map((candidate) => ({
        ...candidate,
        proposal_primary: candidate.file_name === usableSources[0].resolvedAttachment.file_name,
        selection_reason: candidate.file_name === usableSources[0].resolvedAttachment.file_name ? "compiled_proposal_candidate" : null,
      })),
    };
    return selected;
  }

  function localPdfFallbackEnabled() {
    return ["1", "true", "yes"].includes(String(process.env.ALLOW_LOCAL_PDF_FALLBACK || "").trim().toLowerCase());
  }

  function urlOrigin(value) {
    try {
      return new URL(value).origin;
    } catch {
      return null;
    }
  }

  async function extractAttachmentText(resolvedAttachment, eventId, result) {
    const cached = cachedAttachmentText(result, resolvedAttachment);
    if (cached) {
      const source = cached.entry.source || null;
      const textLength = cached.entry.text_length || cached.entry.text.length;
      setTextAcquisition(resolvedAttachment, {
        native_text_length: source === "pdf_native" ? textLength : resolvedAttachment.text_acquisition?.native_text_length ?? null,
        ocr_required: source === "pdf_app",
        ocr_attempted: false,
        ocr_status: "cache_hit",
        ocr_text_length: source === "pdf_app" ? textLength : 0,
        text_source: source === "pdf_app" ? "pdf_app_ocr_cache" : source === "pdf_native" ? "pdf_native_cache" : source,
        text_length: textLength,
        usable_text: true,
      });
      recordOcrSummary(result, resolvedAttachment, "cache_hit", {
        source,
        text_length: textLength,
      });
      if (eventId) {
        await updateProcessingEvent(eventId, {}, {
          message: "Attachment text cache hit",
          data: {
            file_name: resolvedAttachment.file_name,
            format: resolvedAttachment.format,
            text_length: textLength,
          },
        });
      }
      return cached.entry.text;
    }

    if (resolvedAttachment.format === "docx") {
      if (eventId) {
        await updateProcessingEvent(eventId, {}, {
          message: "DOCX text extraction started",
          data: {
            file_name: resolvedAttachment.file_name,
            format: resolvedAttachment.format,
          },
        });
      }
      const parsed = await parseDocxBuffer(resolvedAttachment.buffer);
      if (eventId) {
        await updateProcessingEvent(eventId, {}, {
          message: "DOCX text extraction completed",
          data: {
            file_name: resolvedAttachment.file_name,
            text_length: parsed.text?.length || 0,
          },
        });
      }
      rememberAttachmentText(result, resolvedAttachment, parsed.text, "docx");
      setTextAcquisition(resolvedAttachment, {
        native_text_length: parsed.text?.length || 0,
        ocr_required: false,
        ocr_attempted: false,
        ocr_status: null,
        ocr_text_length: 0,
        text_source: "docx",
        text_length: parsed.text?.length || 0,
      });
      return parsed.text;
    }
    if (["pdf", "image"].includes(resolvedAttachment.format)) {
      if (resolvedAttachment.document_type === "proposta" && resolvedAttachment.format === "pdf") {
        try {
          if (eventId) {
            await updateProcessingEvent(eventId, {}, {
              message: "Native PDF text extraction started",
              data: {
                file_name: resolvedAttachment.file_name,
                format: resolvedAttachment.format,
              },
            });
          }
          const parsed = await parsePdfBuffer(resolvedAttachment.buffer);
          const nativeText = parsed.text || "";
          const nativeTextLength = nativeText.length;
          const nativeSufficient = nativePdfTextSufficient(nativeText);
          setTextAcquisition(resolvedAttachment, {
            native_text_length: nativeTextLength,
            ocr_required: !nativeSufficient,
            ocr_attempted: false,
            ocr_status: null,
            ocr_text_length: 0,
            text_source: nativeSufficient ? "pdf_native" : null,
            text_length: nativeSufficient ? nativeTextLength : 0,
          });
          recordOcrSummary(result, resolvedAttachment, "native_pdf_completed", {
            text_length: nativeTextLength,
            sufficient: nativeSufficient,
          });
          if (eventId) {
            await updateProcessingEvent(eventId, {}, {
              message: "Native PDF text extraction completed",
              data: {
                file_name: resolvedAttachment.file_name,
                text_length: nativeTextLength,
                sufficient: nativeSufficient,
              },
            });
          }
          if (nativeSufficient) {
            rememberAttachmentText(result, resolvedAttachment, nativeText, "pdf_native");
            return nativeText;
          }
        } catch (error) {
          setTextAcquisition(resolvedAttachment, {
            native_text_length: 0,
            ocr_required: true,
            native_error: error.message || String(error),
          });
          recordOcrSummary(result, resolvedAttachment, "native_pdf_failed", {
            error: error.message || String(error),
          });
        }
      }

      let ocrFileUrl = resolvedAttachment.url || "";
      if (!ocrFileUrl) {
        const ocrInput = await createOcrInputFromBuffer({
          buffer: resolvedAttachment.buffer,
          fileName: resolvedAttachment.file_name,
          mimeType: resolvedAttachment.mime_type,
        });
        ocrFileUrl = ocrInput?.url || "";
        const ocrUrlDiagnostics = ocrInput?.diagnostics || describeOcrInputUrl({
          url: ocrFileUrl,
          fileName: resolvedAttachment.file_name,
          contentType: resolvedAttachment.mime_type,
          size: resolvedAttachment.size || resolvedAttachment.buffer?.length || null,
        });
        if (ocrFileUrl && ocrInputSelfTestEnabled()) {
          const selfTest = await selfTestOcrInputUrl({
            url: ocrFileUrl,
            expectedContentType: resolvedAttachment.mime_type,
          });
          ocrUrlDiagnostics.ocr_input_self_test = selfTest;
        }
        recordOcrSummary(result, resolvedAttachment, ocrFileUrl ? "pdf_app_input_prepared" : "pdf_app_input_unavailable", {
          reason: ocrFileUrl ? null : "public_base_url_missing",
          ...ocrUrlDiagnostics,
        });
        if (eventId) {
          await updateProcessingEvent(eventId, {}, {
            message: ocrFileUrl ? "PDF-app OCR input prepared" : "PDF-app OCR input unavailable",
            data: {
              file_name: resolvedAttachment.file_name,
              reason: ocrFileUrl ? null : "public_base_url_missing",
              ...ocrUrlDiagnostics,
            },
          });
        }
        if (!ocrFileUrl && !localPdfFallbackEnabled()) {
          setTextAcquisition(resolvedAttachment, {
            native_text_length: resolvedAttachment.text_acquisition?.native_text_length ?? 0,
            ocr_required: true,
            ocr_attempted: false,
            ocr_status: "unavailable",
            ocr_text_length: 0,
            text_length: 0,
            usable_text: false,
            unusable_reason: "ocr_input_unavailable",
          });
          addUniqueNote(
            result,
            `${resolvedAttachment.file_name}: OCR PDF-app non avviato per URL pubblico mancante; fallback PDF locale disabilitato.`
          );
          return "";
        }
      }

      if (ocrFileUrl) {
        try {
          setTextAcquisition(resolvedAttachment, {
            native_text_length: resolvedAttachment.text_acquisition?.native_text_length ?? 0,
            ocr_required: true,
            ocr_attempted: true,
            ocr_status: "started",
            ocr_text_length: 0,
          });
          recordOcrSummary(result, resolvedAttachment, "pdf_app_started");
          if (eventId) {
            await updateProcessingEvent(eventId, {}, {
              message: "PDF-app OCR started",
              data: {
                file_name: resolvedAttachment.file_name,
                format: resolvedAttachment.format,
              },
            });
          }
          const ocrCacheKey = attachmentTextCacheKey(resolvedAttachment);
          const ocrResult = await runSingleFlightOcr(ocrCacheKey, () => ocrFileUrlWithPdfApp({
            fileUrl: ocrFileUrl,
            fileName: resolvedAttachment.file_name,
          }));
          if (ocrResult.ok && ocrResult.text) {
            const quality = ocrResult.quality || ocrQualityForText(ocrResult.text, resolvedAttachment.format);
            const mappedStatus = mapOcrStatus(quality.status || quality.final_status || "ocr_completed");
            setTextAcquisition(resolvedAttachment, {
              native_text_length: resolvedAttachment.text_acquisition?.native_text_length ?? 0,
              ocr_required: true,
              ocr_attempted: true,
              ocr_status: mappedStatus,
              ocr_attempt_count: ocrResult.diagnostics?.ocr_attempt_count || ocrResult.diagnostics?.attempts || null,
              ocr_attempts: ocrResult.diagnostics?.ocr_attempts || null,
              ocr_text_length: ocrResult.text.length,
              text_source: "pdf_app_ocr",
              text_length: ocrResult.text.length,
              usable_text: mappedStatus === "completed",
              unusable_reason: mappedStatus === "completed" ? null : quality.reason || mappedStatus,
            });
            recordOcrSummary(result, resolvedAttachment, "pdf_app_completed", {
              text_length: ocrResult.text.length,
              job_id: ocrResult.job_id || null,
              ocr_final_status: quality.status || quality.final_status || "ocr_completed",
              quality: quality.quality || null,
              reason: quality.reason || null,
              non_whitespace_length: quality.non_whitespace_length || null,
              page_count: quality.page_count || null,
              pdf_app_diagnostics: ocrResult.diagnostics || null,
            });
            if (eventId) {
              await updateProcessingEvent(eventId, {}, {
                message: "PDF-app OCR completed",
                data: {
                  file_name: resolvedAttachment.file_name,
                  text_length: ocrResult.text.length,
                  job_id: ocrResult.job_id || null,
                  ocr_final_status: quality.status || quality.final_status || "ocr_completed",
                  pdf_app_diagnostics: ocrResult.diagnostics || null,
                },
              });
            }
            if (mappedStatus === "completed") {
              rememberAttachmentText(result, resolvedAttachment, ocrResult.text, "pdf_app");
            }
            return ocrResult.text;
          }
          recordOcrSummary(result, resolvedAttachment, "pdf_app_empty", {
            reason: ocrResult.reason || "Nessun testo OCR restituito.",
            job_id: ocrResult.job_id || null,
            ocr_final_status: ocrResult.quality?.status || "ocr_empty",
            quality: ocrResult.quality?.quality || "empty",
            non_whitespace_length: ocrResult.quality?.non_whitespace_length || 0,
            page_count: ocrResult.quality?.page_count || null,
            pdf_app_diagnostics: ocrResult.diagnostics || null,
          });
          setTextAcquisition(resolvedAttachment, {
            native_text_length: resolvedAttachment.text_acquisition?.native_text_length ?? 0,
            ocr_required: true,
            ocr_attempted: true,
            ocr_status: "empty",
            ocr_attempt_count: ocrResult.diagnostics?.ocr_attempt_count || ocrResult.diagnostics?.attempts || null,
            ocr_attempts: ocrResult.diagnostics?.ocr_attempts || null,
            ocr_text_length: 0,
            text_length: 0,
            usable_text: false,
            unusable_reason: "ocr_empty_text",
          });
          if (eventId) {
            await updateProcessingEvent(eventId, {}, {
              message: "PDF-app OCR skipped or empty",
              data: {
                file_name: resolvedAttachment.file_name,
                reason: ocrResult.reason || "Nessun testo OCR restituito.",
                job_id: ocrResult.job_id || null,
                ocr_final_status: ocrResult.quality?.status || "ocr_empty",
                pdf_app_diagnostics: ocrResult.diagnostics || null,
              },
            });
          }
          addUniqueNote(
            result,
            `${resolvedAttachment.file_name}: OCR PDF-app non eseguito o senza testo (${ocrResult.reason || "Nessun testo OCR restituito."})`
          );
        } catch (error) {
          const status = mapOcrStatus(
            error.diagnostics?.final_status === "ocr_retry_exhausted"
              ? "ocr_retry_exhausted"
              : error.diagnostics?.final_error_type || error.diagnostics?.http_status || error.diagnostics?.error || error.message || "ocr_failed"
          );
          setTextAcquisition(resolvedAttachment, {
            native_text_length: resolvedAttachment.text_acquisition?.native_text_length ?? 0,
            ocr_required: true,
            ocr_attempted: true,
            ocr_status: status || "error",
            ocr_attempt_count: error.diagnostics?.ocr_attempt_count || error.diagnostics?.attempts || null,
            ocr_attempts: error.diagnostics?.ocr_attempts || null,
            ocr_text_length: 0,
            text_length: 0,
            usable_text: false,
            unusable_reason: ocrUnusableReason(status),
            final_error_type: error.diagnostics?.final_error_type || null,
          });
          recordOcrSummary(result, resolvedAttachment, "pdf_app_failed", {
            error: error.message || String(error),
            ocr_url_origin: urlOrigin(ocrFileUrl),
            ocr_final_status: error.diagnostics?.final_status || "ocr_failed",
            pdf_app_diagnostics: error.diagnostics || null,
          });
          if (eventId) {
            await updateProcessingEvent(eventId, {}, {
              level: "error",
              message: "PDF-app OCR failed; local parser fallback",
              data: {
                file_name: resolvedAttachment.file_name,
                error: error.message || String(error),
                pdf_app_diagnostics: error.diagnostics || null,
              },
            });
          }
          addUniqueNote(
            result,
            `${resolvedAttachment.file_name}: OCR PDF-app fallito (${error.message || String(error)})`
          );
        }
      }

      if (!localPdfFallbackEnabled()) {
        const existingOcrStatus = result.ocr_summary?.files?.[resolvedAttachment.file_name]?.status;
        setTextAcquisition(resolvedAttachment, {
          native_text_length: resolvedAttachment.text_acquisition?.native_text_length ?? 0,
          ocr_required: resolvedAttachment.text_acquisition?.ocr_required ?? true,
          ocr_attempted: resolvedAttachment.text_acquisition?.ocr_attempted ?? Boolean(ocrFileUrl),
          ocr_status: resolvedAttachment.text_acquisition?.ocr_status || "unavailable",
          ocr_text_length: resolvedAttachment.text_acquisition?.ocr_text_length ?? 0,
          text_length: 0,
          usable_text: false,
          unusable_reason: resolvedAttachment.text_acquisition?.unusable_reason || "ocr_unavailable",
        });
        recordOcrSummary(
          result,
          resolvedAttachment,
          existingOcrStatus || "pdf_app_required_no_local_fallback",
          { local_fallback_disabled: true }
        );
        addUniqueNote(
          result,
          `${resolvedAttachment.file_name}: fallback PDF locale disabilitato; usare testo OCR PDF-app.`
        );
        return "";
      }

      if (resolvedAttachment.format === "pdf") {
        if (eventId) {
          await updateProcessingEvent(eventId, {}, {
            message: "Local PDF text extraction started",
            data: {
              file_name: resolvedAttachment.file_name,
              format: resolvedAttachment.format,
            },
          });
        }
        const parsed = await parsePdfBuffer(resolvedAttachment.buffer);
        if (eventId) {
          await updateProcessingEvent(eventId, {}, {
            message: "Local PDF text extraction completed",
            data: {
              file_name: resolvedAttachment.file_name,
              text_length: parsed.text?.length || 0,
            },
          });
        }
        rememberAttachmentText(result, resolvedAttachment, parsed.text, "local_pdf");
        setTextAcquisition(resolvedAttachment, {
          native_text_length: parsed.text?.length || 0,
          ocr_required: false,
          ocr_attempted: resolvedAttachment.text_acquisition?.ocr_attempted ?? false,
          ocr_status: resolvedAttachment.text_acquisition?.ocr_status || null,
          ocr_text_length: resolvedAttachment.text_acquisition?.ocr_text_length ?? 0,
          text_source: "local_pdf",
          text_length: parsed.text?.length || 0,
        });
        recordOcrSummary(result, resolvedAttachment, "local_pdf_completed", {
          text_length: parsed.text?.length || 0,
        });
        return parsed.text;
      }
    }
    return "";
  }

  async function extractAnnuncioAiFirst({ text, fileName, eventId, result }) {
    try {
      await updateProcessingEvent(eventId, {}, {
        message: "Announcement AI extraction started",
        data: { file_name: fileName, text_length: String(text || "").length },
      });
      const extracted = await aiExtractAnnuncio({ text, fileName });
      await updateProcessingEvent(eventId, {}, {
        message: "Announcement AI extraction completed",
        data: { file_name: fileName },
      });
      return extracted;
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
    const diagnostics = ensureExtractionDiagnostics(result);
    const agentRun = {
      agent_id: "proposta",
      file_name: fileName,
      started_at: new Date().toISOString(),
      input_text_length: String(text || "").length,
    };
    diagnostics.proposta_agent_runs.push(agentRun);
    try {
      await updateProcessingEvent(eventId, {}, {
        message: "Proposal AI extraction started",
        data: {
          file_name: fileName,
          text_length: String(text || "").length,
          agent_id: "proposta",
        },
      });
      const extracted = await aiExtractProposta({ text, fileName, diagnostics: agentRun });
      agentRun.completed_at = new Date().toISOString();
      agentRun.raw_output_json = cloneDiagnostic(agentRun.output_json);
      agentRun.normalized_output_json = cloneDiagnostic(agentRun.output_after_fallbacks);
      agentRun.null_fields = Object.entries(extracted || {})
        .filter(([, value]) => value === null)
        .map(([key]) => key);
      await updateProcessingEvent(eventId, {}, {
        message: "Proposal AI extraction completed",
        data: {
          file_name: fileName,
          agent_id: "proposta",
          model: agentRun.model || null,
          prompt_name: agentRun.prompt_name || null,
          schema_name: agentRun.schema_name || null,
          input_text_length: agentRun.input_text_length,
          feedback_context_length: agentRun.feedback_context_length || 0,
          parse_error: agentRun.parse_error || null,
          schema_validation_errors: agentRun.schema_validation_errors || [],
          output_json: agentRun.normalized_output_json,
        },
      });
      return extracted;
    } catch (error) {
      agentRun.failed_at = new Date().toISOString();
      agentRun.error = error.message || String(error);
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
      await updateProcessingEvent(eventId, {}, {
        message: "Commission AI extraction started",
        data: { file_name: fileName, text_length: String(text || "").length },
      });
      const ai = await aiExtractProvvigionePercentuale({ text, fileName });
      await updateProcessingEvent(eventId, {}, {
        message: "Commission AI extraction completed",
        data: { file_name: fileName },
      });
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

  function updateImmobiliareFallbackFromEmail(result, emailAnnouncement) {
    if (!result?.immobiliare?.url || !emailAnnouncement) return false;
    if (result.immobiliare.ok === true && result.immobiliare.data) return false;
    const fallbackData = {
      source: "email_body_fallback",
      url: result.immobiliare.url,
      title: null,
      description: emailAnnouncement.descrizione || null,
      prezzo: emailAnnouncement.offerta_minima ?? emailAnnouncement.prezzo_base ?? null,
      prezzo_raw: null,
      disponibilita: emailAnnouncement.stato || null,
      indirizzo: emailAnnouncement.indirizzo || emailAnnouncement.indirizzo_raw || null,
      address: null,
      jsonld_found: 0,
    };
    const hasFallbackData = Boolean(
      fallbackData.description ||
        fallbackData.prezzo != null ||
        fallbackData.disponibilita ||
        fallbackData.indirizzo
    );
    if (!hasFallbackData) return false;
    result.immobiliare = {
      ...result.immobiliare,
      fallback_ok: true,
      fallback_source: "email_body",
      data: fallbackData,
    };
    return true;
  }

  function annuncioFromImmobiliareData(immobiliare) {
    const data = immobiliare?.ok === true ? immobiliare.data : null;
    if (!data) return null;
    const price = data.prezzo ?? null;
    return {
      file_pdf: "Immobiliare.it",
      source: data.source || immobiliare.provider || "immobiliare.it",
      source_priority: "immobiliare",
      immobiliare_url: data.url || immobiliare.url || null,
      immobiliare_scraped_at: immobiliare.scraped_at || null,
      immobiliare_provider: immobiliare.provider || data.source || null,
      immobiliare_reference: data.reference || null,
      indirizzo: data.indirizzo || null,
      indirizzo_raw: data.indirizzo || null,
      descrizione: data.description || data.title || null,
      prezzo_base: price,
      offerta_minima: price,
      stato: data.disponibilita || null,
      superficie_mq: data.superficie_mq || null,
      categoria_macro: data.property_type || null,
      tipo_vendita: data.contract || null,
      locali: data.rooms || null,
    };
  }

  function mergeAnnuncioFallbackWithImmobiliare(fallbackAnnuncio, immobiliareAnnuncio) {
    if (!immobiliareAnnuncio || !hasUsefulAnnuncioData(immobiliareAnnuncio)) return fallbackAnnuncio || null;
    const fallback = fallbackAnnuncio || {};
    return {
      ...fallback,
      fallback_annuncio: fallbackAnnuncio || null,
      fallback_source: fallback.source || fallback.file_pdf || null,
      ...Object.fromEntries(
        Object.entries(immobiliareAnnuncio).filter(([, value]) => !isMissingValue(value))
      ),
    };
  }

  function applyImmobiliareAnnuncioOverride(result) {
    const immobiliareAnnuncio = annuncioFromImmobiliareData(result.immobiliare);
    if (!immobiliareAnnuncio) return false;
    const previous = result.extracted?.annuncio || null;
    const next = mergeAnnuncioFallbackWithImmobiliare(previous, immobiliareAnnuncio);
    if (!next) return false;
    result.extracted.annuncio = next;
    return true;
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
    previousResult = null,
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
      attachment_text_cache: normalizedAttachmentTextCache(previousResult?.attachment_text_cache),
      extracted: {
        annuncio: null,
        proposta: null,
        provvigione: null,
      },
      zapier_response: null,
      notes: [],
    };
    ensureExtractionDiagnostics(result);
    attachmentInputs.forEach((attachment) => {
      upsertAttachmentDiagnostic(result, attachment, {
        received: true,
        classified: true,
        read: false,
        text_extracted: false,
        passed_to_ai: false,
      });
    });

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

    const immobiliareUrls = extractImmobiliareAnnouncementUrls(emailText);
    if (immobiliareUrls.length) {
      const url = immobiliareUrls[0];
      try {
        await updateProcessingEvent(event.id, { result }, {
          message: "Immobiliare.it announcement scrape started",
          data: { url },
        });
        const scraped = await scrapeImmobiliareAnnouncement(url);
        result.immobiliare = {
          url,
          ...scraped,
        };
        if (applyImmobiliareAnnuncioOverride(result)) {
          addUniqueNote(result, `${url}: dati annuncio sostituiti con fonte Immobiliare.it/Apify, fallback AI conservato.`);
        }
        await updateProcessingEvent(event.id, { result }, {
          message: scraped.ok ? "Immobiliare.it announcement scraped" : "Immobiliare.it announcement scrape skipped",
          data: result.immobiliare,
        });
      } catch (error) {
        result.immobiliare = {
          url,
          ok: false,
          error: error.message || String(error),
        };
        result.notes.push(`${url}: dati Immobiliare.it non acquisiti (${result.immobiliare.error})`);
        await updateProcessingEvent(event.id, { result }, {
          level: "error",
          message: "Immobiliare.it announcement scrape failed",
          data: result.immobiliare,
        });
      }
    }

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
      if (updateImmobiliareFallbackFromEmail(result, emailAnnouncement)) {
        await updateProcessingEvent(event.id, { result }, {
          message: "Immobiliare.it data filled from email body",
          data: result.immobiliare,
        });
      }
      if (applyImmobiliareAnnuncioOverride(result)) {
        await updateProcessingEvent(event.id, { result }, {
          message: "Announcement extracted data replaced from Immobiliare.it",
          data: result.extracted.annuncio,
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
      const diagnostics = ensureExtractionDiagnostics(result);
      const agentRun = diagnostics.proposta_agent_runs.at(-1);
      if (agentRun) {
        agentRun.before_merge_result_proposta = cloneDiagnostic(result.extracted.proposta);
        agentRun.proposta_agent_for_merge = cloneDiagnostic(extractedProposta);
      }
      result.extracted.proposta = mergeExtractedProposta(result.extracted.proposta, extractedProposta);
      if (agentRun) {
        agentRun.after_merge_result_proposta = cloneDiagnostic(result.extracted.proposta);
      }
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

    const proposalCandidates = [];

    for (const attachment of attachmentInputs) {
      let resolvedAttachment = null;
      try {
        resolvedAttachment = await readAttachment(attachment);
      } catch (error) {
        result.notes.push(`${attachment.file_name}: download fallito (${error.message || String(error)})`);
        recordOcrSummary(result, attachment, "read_failed", {
          error: error.message || String(error),
        });
        await updateProcessingEvent(event.id, { result }, {
          level: "error",
          message: "Attachment read failed",
          data: {
            file_name: attachment.file_name,
            error: error.message || String(error),
          },
        });
        continue;
      }

      if (!resolvedAttachment?.buffer) {
        addUniqueNote(result, `${attachment.file_name}: contenuto allegato non disponibile.`);
        recordOcrSummary(result, attachment, "skipped", {
          reason: "missing_buffer",
        });
        await updateProcessingEvent(event.id, { result }, {
          level: "error",
          message: "Attachment skipped",
          data: {
            file_name: attachment.file_name,
            reason: "missing_buffer",
          },
        });
        continue;
      }

      const safeDescriptor = {
        field_name: resolvedAttachment.field_name,
        file_name: resolvedAttachment.file_name,
        basename: resolvedAttachment.basename,
        extension: resolvedAttachment.extension,
        mime_type: resolvedAttachment.mime_type,
        size: resolvedAttachment.size,
        url: resolvedAttachment.url,
        kind: resolvedAttachment.kind,
        document_type: resolvedAttachment.document_type,
        document_role: resolvedAttachment.document_role,
        classification_reason: resolvedAttachment.classification_reason,
        proposal_candidate: resolvedAttachment.proposal_candidate,
        supported_by_extraction: ["pdf", "docx", "image"].includes(resolvedAttachment.format),
        format: resolvedAttachment.format,
        format_detection: resolvedAttachment.format_detection,
      };
      const existingIndex = result.attachments.findIndex(
        (item) => item.url === safeDescriptor.url || item.file_name === attachment.file_name
      );
      if (existingIndex >= 0) result.attachments[existingIndex] = safeDescriptor;
      upsertAttachmentDiagnostic(result, resolvedAttachment, {
        received: true,
        classified: true,
        read: true,
        text_extracted: false,
        passed_to_ai: false,
      });

      if (resolvedAttachment.kind === "ignored") {
        recordOcrSummary(result, resolvedAttachment, "skipped", {
          reason: "ignored_attachment",
        });
        await updateProcessingEvent(event.id, { result }, {
          message: "Attachment skipped",
          data: {
            file_name: resolvedAttachment.file_name,
            kind: resolvedAttachment.kind,
            format: resolvedAttachment.format,
            reason: "ignored_attachment",
          },
        });
        continue;
      }

      if (resolvedAttachment.format === "png") {
        addUniqueNote(result, `${resolvedAttachment.file_name}: PNG escluso da OCR e analisi AI.`);
        recordOcrSummary(result, resolvedAttachment, "skipped", {
          reason: "png_excluded",
        });
        await updateProcessingEvent(event.id, { result }, {
          message: "Attachment skipped",
          data: {
            file_name: resolvedAttachment.file_name,
            kind: resolvedAttachment.kind,
            format: resolvedAttachment.format,
            reason: "png_excluded",
          },
        });
        continue;
      }

      if (!["pdf", "docx", "image"].includes(resolvedAttachment.format)) {
        result.notes.push(`Formato non supportato: ${resolvedAttachment.file_name}`);
        recordOcrSummary(result, resolvedAttachment, "skipped", {
          reason: "unsupported_format",
        });
        await updateProcessingEvent(event.id, { result }, {
          message: "Attachment skipped",
          data: {
            file_name: resolvedAttachment.file_name,
            kind: resolvedAttachment.kind,
            format: resolvedAttachment.format,
            reason: "unsupported_format",
          },
        });
        continue;
      }

      try {
        if (resolvedAttachment.kind === "provvigione") {
          const attachmentText = await extractAttachmentText(resolvedAttachment, event.id, result);
          if (!hasUsableAttachmentText(result, resolvedAttachment, attachmentText)) continue;
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
          const usableText = hasUsableAttachmentText(result, resolvedAttachment, attachmentText);
          setTextAcquisition(resolvedAttachment, {
            ...(resolvedAttachment.text_acquisition || {}),
            text_length: String(attachmentText || "").length,
            usable_text: usableText,
            unusable_reason: usableText ? null : resolvedAttachment.text_acquisition?.unusable_reason || "text_unusable",
          });
          const classifiedAttachment = refineProposalClassificationWithText(resolvedAttachment, attachmentText);
          Object.assign(resolvedAttachment, classifiedAttachment);
          const updatedDescriptor = {
            field_name: resolvedAttachment.field_name,
            file_name: resolvedAttachment.file_name,
            basename: resolvedAttachment.basename,
            extension: resolvedAttachment.extension,
            mime_type: resolvedAttachment.mime_type,
            size: resolvedAttachment.size,
            url: resolvedAttachment.url,
            kind: resolvedAttachment.kind,
            document_type: resolvedAttachment.document_type,
            document_role: resolvedAttachment.document_role,
            template_filename_evidence: resolvedAttachment.template_filename_evidence,
            placeholder_evidence: resolvedAttachment.placeholder_evidence,
            compiled_value_evidence: resolvedAttachment.compiled_value_evidence,
            classification_reason: resolvedAttachment.classification_reason,
            proposal_candidate: resolvedAttachment.proposal_candidate,
            supported_by_extraction: ["pdf", "docx", "image"].includes(resolvedAttachment.format),
            format: resolvedAttachment.format,
            format_detection: resolvedAttachment.format_detection,
          };
          if (existingIndex >= 0) result.attachments[existingIndex] = updatedDescriptor;
          upsertAttachmentDiagnostic(result, resolvedAttachment, {
            text_extracted: Boolean(attachmentText),
            text_length: String(attachmentText || "").length,
            usable_text: usableText,
            unusable_reason: resolvedAttachment.text_acquisition?.unusable_reason || null,
            passed_to_ai: false,
          });
          proposalCandidates.push({
            resolvedAttachment,
            text: attachmentText,
            text_extracted: Boolean(attachmentText),
            usable_text: usableText,
          });
          await updateProcessingEvent(event.id, { result }, {
            message: "Proposal attachment classified",
            data: attachmentDiagnostic(resolvedAttachment, {
              text_extracted: Boolean(attachmentText),
              text_length: String(attachmentText || "").length,
              usable_text: usableText,
              unusable_reason: resolvedAttachment.text_acquisition?.unusable_reason || null,
            }),
          });
          continue;
        }

        if (resolvedAttachment.kind === "annuncio") {
          const attachmentText = await extractAttachmentText(resolvedAttachment, event.id, result);
          if (!hasUsableAttachmentText(result, resolvedAttachment, attachmentText)) continue;
          const extractedAnnuncio = await extractAnnuncioAiFirst({
            text: attachmentText,
            fileName: resolvedAttachment.file_name,
            eventId: event.id,
            result,
          });
          result.extracted.annuncio = extractedAnnuncio;
          applyImmobiliareAnnuncioOverride(result);
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
      recordOcrSummary(result, resolvedAttachment, "skipped", {
        reason: "unclassified_attachment",
      });
      await updateProcessingEvent(event.id, { result }, {
        message: "Attachment skipped",
        data: {
          file_name: resolvedAttachment.file_name,
          kind: resolvedAttachment.kind,
          format: resolvedAttachment.format,
          reason: "unclassified_attachment",
        },
      });
    }

    const selectedProposalCandidates = selectProposalCandidates(result, proposalCandidates);
    for (const candidate of selectedProposalCandidates) {
      const { resolvedAttachment, text: attachmentText } = candidate;
      try {
        upsertAttachmentDiagnostic(result, resolvedAttachment, {
          passed_to_ai: true,
          proposal_primary: Boolean(candidate.proposal_primary),
          selection_reason: candidate.selection_reason,
          selection_score: proposalSelectionScore(candidate),
        });
        const extractedProposta = await extractPropostaAiFirst({
          text: attachmentText,
          fileName: resolvedAttachment.file_name,
          eventId: event.id,
          result,
        });
        extractedProposta.source_format = resolvedAttachment.format;
        extractedProposta.document_role = resolvedAttachment.document_role;
        const diagnostics = ensureExtractionDiagnostics(result);
        const agentRun = diagnostics.proposta_agent_runs.at(-1);
        if (agentRun) {
          agentRun.document_role = resolvedAttachment.document_role;
          agentRun.proposal_primary = Boolean(candidate.proposal_primary);
          agentRun.selection_reason = candidate.selection_reason;
          agentRun.before_merge_result_proposta = cloneDiagnostic(result.extracted.proposta);
          agentRun.proposta_agent_for_merge = cloneDiagnostic(extractedProposta);
        }
        result.extracted.proposta = mergeExtractedProposta(result.extracted.proposta, extractedProposta);
        if (agentRun) {
          agentRun.after_merge_result_proposta = cloneDiagnostic(result.extracted.proposta);
        }
        await updateProcessingEvent(event.id, { result }, {
          message: candidate.proposal_primary ? "Primary proposal extracted" : "Additional proposal extracted",
          data: {
            file_name: resolvedAttachment.file_name,
            proposal_primary: Boolean(candidate.proposal_primary),
            selection_reason: candidate.selection_reason,
            extracted: extractedProposta,
          },
        });
      } catch (error) {
        result.notes.push(
          `${resolvedAttachment.file_name}: estrazione proposta fallita (${error.message || String(error)})`
        );
      }
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
    if (result.extraction_diagnostics?.proposta_agent_runs?.length) {
      const diagnostics = ensureExtractionDiagnostics(result);
      const lastProposalRun = diagnostics.proposta_agent_runs.at(-1);
      const ocrText = diagnostics.ocr_texts.at(-1)?.text?.text ||
        [
          diagnostics.ocr_texts.at(-1)?.text?.text_head,
          diagnostics.ocr_texts.at(-1)?.text?.text_tail,
        ].filter(Boolean).join("\n");
      diagnostics.final_result = finalResultDiagnosticSnapshot(result);
      diagnostics.proposta_field_matrix = buildProposalFieldMatrix({
        ocrText,
        agentOutput: lastProposalRun?.proposta_agent_for_merge || lastProposalRun?.normalized_output_json || {},
        mergedResult: result,
        finalResult: result,
      });
      lastProposalRun.final_missing_fields = cloneDiagnostic(result.missing_fields || []);
    }
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
          ocr_summary: result.ocr_summary || null,
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
