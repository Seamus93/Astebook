function normalizedName(value) {
  return String(value || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[._-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function describeAttachmentFile(fileName) {
  const cleanName = String(fileName || "allegato").split(/[\\/]/).filter(Boolean).pop() || "allegato";
  const lastDot = cleanName.lastIndexOf(".");
  const hasExtension = lastDot > 0 && lastDot < cleanName.length - 1;
  const basename = hasExtension ? cleanName.slice(0, lastDot) : cleanName;
  const extension = hasExtension ? cleanName.slice(lastDot + 1).toLowerCase() : "";
  return {
    file_name: cleanName,
    basename,
    extension,
  };
}

function mimeFormat(mimeType = "") {
  const mime = String(mimeType || "").toLowerCase();
  if (mime.includes("pdf")) return "pdf";
  if (mime.includes("wordprocessingml.document")) return "docx";
  if (mime === "image/png") return "png";
  if (mime.startsWith("image/")) return "image";
  return "";
}

function extensionFormat(extension = "") {
  const ext = String(extension || "").toLowerCase();
  if (ext === "pdf") return "pdf";
  if (ext === "docx") return "docx";
  if (ext === "png") return "png";
  if (/^(jpe?g|bmp|tiff?|webp|heic)$/.test(ext)) return "image";
  return "";
}

function magicFormat(buffer) {
  if (!buffer?.length) return "";
  if (buffer.subarray(0, 4).toString("utf8") === "%PDF") return "pdf";
  if (buffer.subarray(0, 2).toString("utf8") === "PK") return "docx";
  return "";
}

export function proposalTemplateNameReasons(basenameOrFileName) {
  const name = normalizedName(basenameOrFileName);
  const reasons = [];
  const hasProposalWord = /\b(proposta|offerta|offer)\b/.test(name);
  const templateMatch = name.match(/\b(format|formato|modello|template|fac\s*simile|facsimile)\b/);
  if (hasProposalWord) {
    if (/\bproposta\b/.test(name)) reasons.push("filename_contains_proposta");
    if (/\bofferta\b|\boffer\b/.test(name)) reasons.push("filename_contains_offerta");
  }
  if (templateMatch) {
    const token = templateMatch[1].replace(/\s+/g, "_");
    reasons.push(`filename_contains_${token}`);
  }
  if (hasProposalWord && templateMatch) reasons.push("proposal_template_filename_pattern");
  return reasons;
}

export function classifyAttachmentDescriptor({ fileName, mimeType = "", buffer = null } = {}) {
  const file = describeAttachmentFile(fileName);
  const mime_type = String(mimeType || "");
  const normalizedBase = normalizedName(file.basename);
  const normalizedFileName = normalizedName(file.file_name);
  const extension_format = extensionFormat(file.extension);
  const mime_format = mimeFormat(mime_type);
  const magic_format = magicFormat(buffer);
  const format = magic_format || mime_format || extension_format || "unknown";
  const classification_reason = [];

  if (file.extension) classification_reason.push(`extension_${file.extension}`);
  if (mime_format) classification_reason.push(`mime_${mime_format}`);
  if (magic_format) classification_reason.push(`magic_${magic_format}`);
  if (extension_format && mime_format && extension_format !== mime_format) {
    classification_reason.push("mime_extension_mismatch");
  }
  if (extension_format && magic_format && extension_format !== magic_format) {
    classification_reason.push("magic_extension_mismatch");
  }
  if (mime_format && magic_format && mime_format !== magic_format) {
    classification_reason.push("magic_mime_mismatch");
  }

  let document_type = "unknown";
  let document_role = null;
  let kind = "unknown";

  if (
    /privacy|aml|antiriciclaggio|bonifico|distin[gt]a|istinta|codice\s*fiscale|\bcf\b|document[oi]\s+cliente/.test(normalizedFileName)
  ) {
    document_type = "ignored";
    document_role = "supporting";
    kind = "ignored";
    classification_reason.push("ignored_filename_pattern");
  } else if (/provvigione|commission|raccolta\s+offerte/.test(normalizedFileName)) {
    document_type = "provvigione";
    document_role = "source";
    kind = "provvigione";
    classification_reason.push("filename_contains_provvigione");
  } else if (/\b(proposta|offerta|offer)\b/.test(normalizedBase)) {
    document_type = "proposta";
    kind = "proposta";
    classification_reason.push(...proposalTemplateNameReasons(file.basename));
    if (classification_reason.includes("proposal_template_filename_pattern")) {
      document_role = "template";
      if (format === "docx") classification_reason.push("docx_template_pattern");
      else classification_reason.push("template_filename_pattern");
    } else {
      document_role = "source";
      classification_reason.push("proposal_source_filename_pattern");
    }
  } else if (/annuncio|disciplinare|gara|asta|lotto/.test(normalizedFileName)) {
    document_type = "annuncio";
    document_role = "source";
    kind = "annuncio";
    classification_reason.push("filename_contains_annuncio");
  }

  return {
    ...file,
    mime_type,
    format,
    format_detection: {
      extension: file.extension || null,
      extension_format: extension_format || null,
      mime_format: mime_format || null,
      magic_format: magic_format || null,
      source: magic_format ? "magic" : mime_format ? "mime_type" : extension_format ? "extension" : "unknown",
      mismatch: classification_reason.filter((reason) => reason.includes("_mismatch")),
    },
    document_type,
    document_role,
    classification_reason: Array.from(new Set(classification_reason)),
    kind,
    proposal_candidate: document_type === "proposta" && document_role === "source",
  };
}

export function scoreProposalContent(text) {
  const value = normalizedName(text);
  const raw = String(text || "");
  const reasons = [];
  let compiled_score = 0;
  let template_score = 0;

  const compiledPatterns = [
    ["content_contains_proposta_irrevocabile", /proposta\s+irrevocabile/],
    ["content_contains_proponente_acquirente", /proponente\s+acquirente/],
    ["content_contains_sottoscritto", /sottoscritt[oa]/],
    ["content_contains_codice_fiscale", /codice\s+fiscale|[A-Z]{6}\d{2}[A-Z]\d{2}[A-Z]\d{3}[A-Z]/i],
    ["content_contains_catasto", /foglio\s+\w{1,8}[\s,;]+(?:particella|mappale)\s+\w{1,12}|catasto\s+fabbricati/],
    ["content_contains_subalterno", /\bsub(?:alterno)?\.?\s+\w{1,8}/],
    ["content_contains_address", /\b(via|viale|vicolo|piazza|corso|largo)\b\s+\w+/],
    ["content_contains_amount", /(?:euro|eur|\b€)\s*[\d.]{2,}(?:,\d{2})?|[\d.]{2,},\d{2}\s*(?:euro|eur|€)/],
    ["content_contains_firma", /firma|sottoscrizione/],
  ];
  for (const [reason, pattern] of compiledPatterns) {
    if (pattern.test(value) || pattern.test(raw)) {
      compiled_score += 1;
      reasons.push(reason);
    }
  }

  const templatePatterns = [
    ["content_contains_template_word", /\b(format|formato|modello|template|fac\s*simile|facsimile)\b/],
    ["content_contains_placeholder_lines", /_{4,}|\.{5,}/],
    ["content_contains_bracket_placeholders", /\[[^\]]{1,40}\]|\{\{[^}]{1,40}\}\}/],
    ["content_contains_da_compilare", /da\s+compilare|compilare\s+a\s+cura|nome\s+cognome/],
  ];
  for (const [reason, pattern] of templatePatterns) {
    if (pattern.test(value) || pattern.test(raw)) {
      template_score += 1;
      reasons.push(reason);
    }
  }

  let role_evidence = "weak";
  if (compiled_score >= 3) role_evidence = "compiled";
  else if (template_score >= 2 && compiled_score === 0) role_evidence = "template";

  return {
    compiled_score,
    template_score,
    role_evidence,
    classification_reason: reasons,
  };
}

export function refineProposalClassificationWithText(descriptor, text) {
  if (descriptor?.document_type !== "proposta") return descriptor;
  const score = scoreProposalContent(text);
  const next = {
    ...descriptor,
    content_score: {
      compiled_score: score.compiled_score,
      template_score: score.template_score,
      role_evidence: score.role_evidence,
    },
    classification_reason: Array.from(new Set([
      ...(descriptor.classification_reason || []),
      ...score.classification_reason,
    ])),
  };
  if (score.role_evidence === "compiled") {
    next.document_role = "source";
    next.classification_reason.push("content_compiled_proposal_evidence");
  } else if (score.role_evidence === "template") {
    next.document_role = "template";
    next.classification_reason.push("content_template_evidence");
  }
  next.classification_reason = Array.from(new Set(next.classification_reason));
  next.proposal_candidate = next.document_type === "proposta" && next.document_role === "source";
  return next;
}

function attachmentKind(fileName, mimeType = "") {
  return classifyAttachmentDescriptor({ fileName, mimeType }).kind;
}

function isPdfAttachment(attachment) {
  return (
    String(attachment.mime_type || "").toLowerCase().includes("pdf") ||
    String(attachment.file_name || "").toLowerCase().endsWith(".pdf")
  );
}

function isDocxAttachment(attachment) {
  const mime = String(attachment.mime_type || "").toLowerCase();
  const fileName = String(attachment.file_name || "").toLowerCase();
  return mime.includes("wordprocessingml.document") || fileName.endsWith(".docx");
}

function isPngAttachment(attachment) {
  const mime = String(attachment.mime_type || "").toLowerCase();
  const fileName = String(attachment.file_name || "").toLowerCase();
  return mime === "image/png" || fileName.endsWith(".png");
}

function isImageAttachment(attachment) {
  if (isPngAttachment(attachment)) return false;
  const mime = String(attachment.mime_type || "").toLowerCase();
  const fileName = String(attachment.file_name || "").toLowerCase();
  return (
    mime.startsWith("image/") ||
    /\.(jpe?g|png|bmp|tiff?|webp)$/i.test(fileName)
  );
}

function attachmentKeyLooksRelevant(key) {
  return /attachment|attachments|file|files|allegat/i.test(String(key || ""));
}

function extractUrls(value) {
  return String(value || "").match(/https?:\/\/[^\s"',<>{}\]]+/gi) || [];
}

function filenameFromUrl(url) {
  try {
    const parsed = new URL(url);
    const last = parsed.pathname.split("/").filter(Boolean).pop();
    return last ? decodeURIComponent(last) : null;
  } catch {
    return null;
  }
}

function filenameFromContentDisposition(value) {
  const header = String(value || "");
  const encoded = header.match(/filename\*=UTF-8''([^;]+)/i)?.[1];
  if (encoded) return decodeURIComponent(encoded);
  const plain = header.match(/filename="?([^";]+)"?/i)?.[1];
  return plain || null;
}

function tryParseJsonString(value) {
  const text = String(value || "").trim();
  if (!/^[\[{]/.test(text)) return null;
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

function normalizeAttachmentDescriptor(raw) {
  const url =
    raw?.attachment ||
    raw?.url ||
    raw?.file ||
    raw?.download_url ||
    raw?.href ||
    raw?.value ||
    null;
  const fileName =
    raw?.fileName ||
    raw?.file_name ||
    raw?.filename ||
    raw?.truncateFilename ||
    raw?.truncate_filename ||
    raw?.name ||
    raw?.originalname ||
    raw?.title ||
    filenameFromUrl(url) ||
    "allegato";
  const mimeType = raw?.mime_type || raw?.mimetype || raw?.mimeType || raw?.content_type || "";

  if (!url && !raw?.buffer) return null;
  const classification = classifyAttachmentDescriptor({
    fileName,
    mimeType,
    buffer: raw?.buffer || null,
  });

  return {
    field_name: raw?.fieldname || raw?.field_name || null,
    file_name: classification.file_name,
    basename: classification.basename,
    extension: classification.extension,
    mime_type: String(mimeType),
    size: raw?.size || null,
    url: typeof url === "string" && /^https?:\/\//i.test(url) ? url : null,
    kind: classification.kind,
    document_type: classification.document_type,
    document_role: classification.document_role,
    classification_reason: classification.classification_reason,
    proposal_candidate: classification.proposal_candidate,
    supported_by_extraction:
      !isPngAttachment({ file_name: fileName, mime_type: mimeType }) &&
      (isPdfAttachment({
        file_name: fileName,
        mime_type: mimeType,
      }) ||
        isDocxAttachment({ file_name: fileName, mime_type: mimeType }) ||
        isImageAttachment({ file_name: fileName, mime_type: mimeType })),
    buffer: raw?.buffer || null,
  };
}

export function collectZapierAttachments(body, files) {
  const collected = [];
  const seen = new Set();

  const add = (descriptor) => {
    if (!descriptor) return;
    const key = descriptor.url || `${descriptor.file_name}|${descriptor.field_name || ""}`;
    if (seen.has(key)) return;
    seen.add(key);
    collected.push(descriptor);
  };

  (Array.isArray(files) ? files : []).forEach((file) => add(normalizeAttachmentDescriptor(file)));

  if (body && typeof body === "object" && !Array.isArray(body)) {
    const groups = {};
    Object.entries(body).forEach(([key, value]) => {
      const match = String(key).match(/^(attachment|file|allegato)[\s_-]*(\d+)[\s_-]*(.+)$/i);
      if (!match) return;
      const groupKey = `${match[1].toLowerCase()}_${match[2]}`;
      groups[groupKey] = groups[groupKey] || {};
      groups[groupKey][match[3]] = value;
    });
    Object.values(groups).forEach((group) => add(normalizeAttachmentDescriptor(group)));
  }

  const visit = (value, key = "") => {
    if (!value) return;

    if (typeof value === "string") {
      const parsed = tryParseJsonString(value);
      if (parsed) {
        visit(parsed, key);
        return;
      }

      if (attachmentKeyLooksRelevant(key)) {
        extractUrls(value).forEach((url, index) => {
          add(
            normalizeAttachmentDescriptor({
              attachment: url,
              fileName: index === 0 ? key : `${key}_${index + 1}`,
            })
          );
        });
      }
      return;
    }

    if (Array.isArray(value)) {
      value.forEach((item, index) => visit(item, `${key}_${index + 1}`));
      return;
    }

    if (typeof value === "object") {
      const descriptor = normalizeAttachmentDescriptor(value);
      if (descriptor) add(descriptor);
      Object.entries(value).forEach(([childKey, childValue]) => visit(childValue, childKey));
    }
  };

  visit(body);
  return collected;
}

function inferAttachmentFormat(attachment, buffer) {
  return classifyAttachmentDescriptor({
    fileName: attachment?.file_name,
    mimeType: attachment?.mime_type,
    buffer,
  }).format;
}

export async function readAttachment(attachment) {
  if (attachment.buffer) {
    const classification = classifyAttachmentDescriptor({
      fileName: attachment.file_name,
      mimeType: attachment.mime_type,
      buffer: attachment.buffer,
    });
    return {
      ...attachment,
      ...classification,
      buffer: attachment.buffer,
    };
  }
  if (!attachment.url) return null;

  const response = await fetch(attachment.url);
  if (!response.ok) {
    throw new Error(
      `Download allegato fallito (${attachment.file_name}): ${response.status} ${response.statusText}`
    );
  }

  const buffer = Buffer.from(await response.arrayBuffer());
  const headerFileName = filenameFromContentDisposition(response.headers.get("content-disposition"));
  const mimeType = response.headers.get("content-type") || attachment.mime_type || "";
  const fileName =
    headerFileName ||
    (attachment.file_name && !/^attachments?(_\d+)?$/i.test(attachment.file_name)
      ? attachment.file_name
      : filenameFromUrl(attachment.url)) ||
    attachment.file_name;

  const classification = classifyAttachmentDescriptor({
    fileName,
    mimeType,
    buffer,
  });
  const resolved = {
    ...attachment,
    ...classification,
    mime_type: mimeType,
    buffer,
  };
  return {
    ...resolved,
    format: inferAttachmentFormat(resolved, buffer),
  };
}
