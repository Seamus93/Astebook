function attachmentKind(fileName) {
  const name = String(fileName || "").toLowerCase();
  if (/privacy|aml|antiriciclaggio|bonifico|distin[gt]a|istinta|codice\s*fiscale|\bcf\b|document[oi]\s+cliente/.test(name)) {
    return "ignored";
  }
  if (/provvigione|commission|raccolta\s+offerte/.test(name)) return "provvigione";
  if (/proposta|offerta|offer/.test(name)) return "proposta";
  if (/annuncio|disciplinare|gara|asta|lotto/.test(name)) return "annuncio";
  return "unknown";
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

  return {
    field_name: raw?.fieldname || raw?.field_name || null,
    file_name: String(fileName),
    mime_type: String(mimeType),
    size: raw?.size || null,
    url: typeof url === "string" && /^https?:\/\//i.test(url) ? url : null,
    kind: attachmentKind(fileName),
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
  if (isPdfAttachment(attachment)) return "pdf";
  if (isDocxAttachment(attachment)) return "docx";
  if (isPngAttachment(attachment)) return "png";
  if (buffer?.subarray(0, 4).toString("utf8") === "%PDF") return "pdf";
  if (buffer?.subarray(0, 2).toString("utf8") === "PK") return "docx";
  if (isImageAttachment(attachment)) return "image";
  return "unknown";
}

export async function readAttachment(attachment) {
  if (attachment.buffer) {
    return {
      ...attachment,
      buffer: attachment.buffer,
      format: inferAttachmentFormat(attachment, attachment.buffer),
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

  const resolved = {
    ...attachment,
    file_name: fileName,
    mime_type: mimeType,
    kind: attachment.kind === "unknown" ? attachmentKind(fileName) : attachment.kind,
    buffer,
  };
  return {
    ...resolved,
    format: inferAttachmentFormat(resolved, buffer),
  };
}
