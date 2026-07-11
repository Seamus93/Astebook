export function redactSecret(value) {
  if (!value) return "";
  const str = String(value);
  if (str.length <= 8) return "********";
  return `${str.slice(0, 4)}...${str.slice(-4)}`;
}

export function parseEmailRecipients(value) {
  return String(value || "")
    .split(/[,\n;]/)
    .map((item) => item.trim())
    .filter(Boolean);
}

export function validateEmailRecipients(recipients) {
  const invalid = recipients.filter((email) => !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email));
  if (invalid.length) {
    throw new Error(`Destinatari non validi: ${invalid.join(", ")}`);
  }
}

export function configIssue(key, label, detail) {
  return { key, label, detail };
}

export function smtpConfigurationIssues(smtp) {
  const issues = [];
  if (!smtp.host) {
    issues.push(configIssue("smtp_host", "SMTP Host", "Configura l'host SMTP."));
  }
  if (!smtp.from) {
    issues.push(configIssue("smtp_from", "SMTP From", "Configura il mittente SMTP."));
  }
  if (!Number.isInteger(smtp.port) || smtp.port <= 0) {
    issues.push(configIssue("smtp_port", "SMTP Port", "Configura una porta SMTP valida, ad esempio 465 o 587."));
  }
  if (smtp.port === 587 && smtp.secure) {
    issues.push(configIssue("smtp_secure", "SMTP Secure", "Per la porta 587 imposta SMTP Secure su false: la cifratura avviene tramite STARTTLS."));
  }
  if (smtp.port === 465 && !smtp.secure) {
    issues.push(configIssue("smtp_secure", "SMTP Secure", "Per la porta 465 imposta SMTP Secure su true."));
  }
  if (smtp.user && !smtp.password) {
    issues.push(configIssue("smtp_password", "SMTP Password", "SMTP User e configurato ma manca SMTP Password."));
  }
  return issues;
}

export async function collectPipelineConfigurationIssues({ getEffectiveSetting, getSmtpSettings }) {
  const issues = [];
  const aiApiKey = await getEffectiveSetting("AI_API_KEY", "ai_api_key");
  const aiBaseUrl = await getEffectiveSetting("AI_BASE_URL", "ai_base_url");
  const aiModel = await getEffectiveSetting("AI_MODEL", "ai_model");
  const pdfAppApiKey = await getEffectiveSetting("PDF_APP_API_KEY", "pdf_app_api_key");
  const pdfAppOcrEndpoint = await getEffectiveSetting("PDF_APP_OCR_ENDPOINT", "pdf_app_ocr_endpoint");
  const documentTemplateUrl = await getEffectiveSetting("DOCUMENT_TEMPLATE_URL", "document_template_url");
  const documentSendTo = await getEffectiveSetting("DOCUMENT_SEND_TO", "document_send_to");

  if (process.env.ASTEBOOK_AI_MOCK !== "1" && !String(aiApiKey || "").trim()) {
    issues.push(configIssue("ai_api_key", "AI API Key", "Configura la chiave API per l'analisi AI."));
  }
  if (!String(aiBaseUrl || "").trim()) {
    issues.push(configIssue("ai_base_url", "AI Base URL", "Configura l'endpoint AI."));
  }
  if (!String(aiModel || "").trim()) {
    issues.push(configIssue("ai_model", "AI Model", "Configura il modello AI."));
  }
  if (!String(pdfAppApiKey || "").trim()) {
    issues.push(configIssue("pdf_app_api_key", "PDF-app API Key", "Configura la chiave PDF-app per OCR."));
  }
  if (!String(pdfAppOcrEndpoint || "").trim()) {
    issues.push(configIssue("pdf_app_ocr_endpoint", "PDF-app OCR Endpoint", "Configura l'endpoint OCR PDF-app."));
  }
  if (!String(documentTemplateUrl || "").trim()) {
    issues.push(configIssue("document_template_url", "Template Documento", "Configura il template Google Doc/DOCX per generare il PDF."));
  }

  const recipients = parseEmailRecipients(documentSendTo);
  if (!recipients.length) {
    issues.push(configIssue("document_send_to", "Send to", "Configura almeno un destinatario email."));
  } else {
    try {
      validateEmailRecipients(recipients);
    } catch (error) {
      issues.push(configIssue("document_send_to", "Send to", error.message || String(error)));
    }
  }

  issues.push(...smtpConfigurationIssues(await getSmtpSettings()));

  return issues;
}

export async function collectDocumentEmailConfigurationIssues({ recipients, getEffectiveSetting, getSmtpSettings }) {
  const issues = [];
  const documentTemplateUrl = await getEffectiveSetting("DOCUMENT_TEMPLATE_URL", "document_template_url");
  if (!String(documentTemplateUrl || "").trim()) {
    issues.push(configIssue("document_template_url", "Template Documento", "Configura il template Google Doc/DOCX per generare il PDF."));
  }
  if (!recipients.length) {
    issues.push(configIssue("document_send_to", "Send to", "Configura almeno un destinatario email."));
  } else {
    try {
      validateEmailRecipients(recipients);
    } catch (error) {
      issues.push(configIssue("document_send_to", "Send to", error.message || String(error)));
    }
  }
  issues.push(...smtpConfigurationIssues(await getSmtpSettings()));
  return issues;
}
