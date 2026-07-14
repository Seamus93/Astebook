export const emailInterceptorAgent = {
  id: "email_interceptor",
  description: "Valuta se una email in ingresso e rilevante per la pipeline Astebook.",
  prompt: `
Sei un agente di intercettazione email per Astebook.
Devi decidere se una email contiene materiale valido per avviare la pipeline:
- email da mittenti autorizzati, anche quando l'indirizzo compare in un inoltro;
- oggetto o corpo compatibile con procedure, proposte, aste o documenti di gara;
- allegati coerenti con il file richiesto configurato.
Restituisci una decisione con motivazioni brevi e verificabili.
`.trim(),
};

export const PROMPT_INTERCEPTOR = emailInterceptorAgent.prompt;

function normalizeAddress(address) {
  return String(address || "").trim().toLowerCase();
}

function parseList(value) {
  return String(value || "")
    .split(/[,;\n]+/)
    .map((item) => item.trim().toLowerCase())
    .filter(Boolean);
}

function searchableText(value) {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function unique(values) {
  return Array.from(new Set(values.filter(Boolean)));
}

function addressesFromAddressObject(value) {
  if (!value) return [];
  if (Array.isArray(value)) {
    return value.flatMap(addressesFromAddressObject);
  }
  if (Array.isArray(value.value)) {
    return value.value.map((item) => normalizeAddress(item.address)).filter(Boolean);
  }
  if (typeof value === "object" && value.address) {
    return [normalizeAddress(value.address)].filter(Boolean);
  }
  return addressesFromText(value);
}

function addressesFromHeader(headers, name) {
  const value = headers?.get?.(name);
  return addressesFromAddressObject(value);
}

function addressesFromText(text) {
  return unique(
    String(text || "")
      .match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi)
      ?.map(normalizeAddress) || []
  );
}

function forwardedAddressesFromText(text) {
  const lines = String(text || "").split(/\r?\n/);
  return unique(
    lines.flatMap((line) => {
      if (!/^\s*(da|from|mittente)\s*:/i.test(line)) return [];
      return addressesFromText(line);
    })
  );
}

export function attachmentFilenameMatchesRequired(fileName, requiredFilename) {
  const keyword = searchableText(requiredFilename);
  if (!keyword) return true;

  const filename = searchableText(fileName);
  if (filename.includes(keyword)) return true;

  const keywordTokens = keyword.split(/\s+/).filter(Boolean);
  return keywordTokens.length > 0 && keywordTokens.every((token) => filename.includes(token));
}

export function collectEmailAddressCandidates(message = {}) {
  const from = addressesFromAddressObject(message.from);
  const sender = addressesFromAddressObject(message.sender);
  const replyTo = addressesFromAddressObject(message.replyTo);
  const headerFrom = addressesFromHeader(message.headers, "from");
  const headerSender = addressesFromHeader(message.headers, "sender");
  const headerReplyTo = addressesFromHeader(message.headers, "reply-to");
  const forwarded = forwardedAddressesFromText(message.text || message.email_body_text || "");

  return {
    from: unique([...from, ...headerFrom]),
    sender: unique([...sender, ...headerSender]),
    reply_to: unique([...replyTo, ...headerReplyTo]),
    forwarded_from: forwarded,
    all: unique([...from, ...sender, ...replyTo, ...headerFrom, ...headerSender, ...headerReplyTo, ...forwarded]),
  };
}

export function collectEmailSenderAddresses(message = {}) {
  return collectEmailAddressCandidates(message).all;
}

export function evaluateEmailInterceptorDecision({
  message = {},
  settings = {},
  state = {},
  messageKey = null,
} = {}) {
  const allowlist = Array.isArray(settings.fromAllowlist)
    ? settings.fromAllowlist.map(normalizeAddress).filter(Boolean)
    : parseList(settings.fromAllowlist);
  const requiredFilename = settings.requiredFilename || "proposta";
  const attachments = Array.isArray(message.attachments) ? message.attachments : [];
  const filenames = attachments
    .map((attachment) => String(attachment.filename || attachment.file_name || attachment.originalname || "").trim())
    .filter(Boolean);
  const candidates = collectEmailAddressCandidates(message);
  const senderAllowed =
    allowlist.length === 0 || candidates.all.some((address) => allowlist.includes(address));
  const requiredFilenameMatch = filenames.some((filename) =>
    attachmentFilenameMatchesRequired(filename, requiredFilename)
  );

  const messageDate = message.date instanceof Date ? message.date : message.date ? new Date(message.date) : null;
  const ignoreBeforeDate = state.ignore_before ? new Date(state.ignore_before) : null;
  const beforeBaseline =
    messageDate &&
    ignoreBeforeDate &&
    Number.isFinite(messageDate.getTime()) &&
    Number.isFinite(ignoreBeforeDate.getTime()) &&
    messageDate.getTime() < ignoreBeforeDate.getTime();
  const processed = Array.isArray(state.processed)
    ? state.processed.some((item) => String(item || "").trim() === String(messageKey || "").trim())
    : false;

  const reasons = [];
  if (beforeBaseline) reasons.push("before_baseline");
  if (processed) reasons.push("already_processed");
  if (!senderAllowed) reasons.push("sender_not_allowed");
  if (!requiredFilenameMatch) reasons.push("required_attachment_missing");

  return {
    agent_id: emailInterceptorAgent.id,
    processable: reasons.length === 0,
    status: reasons.length === 0 ? "processable" : "skipped",
    reasons,
    sender_allowed: senderAllowed,
    required_filename_match: requiredFilenameMatch,
    before_baseline: Boolean(beforeBaseline),
    processed,
    allowed_from: allowlist,
    sender_candidates: candidates,
    required_filename: requiredFilename,
    filenames,
  };
}
