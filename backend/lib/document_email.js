import { existsSync } from "node:fs";
import { documentDisplayTitle, documentFileName, documentProcedureCode } from "./document_naming.js";
import { escapeHtml } from "./html.js";
import { parseEmailRecipients, validateEmailRecipients } from "./settings_validation.js";

function qualityResponsibility(field) {
  const text = `${field?.field || ""} ${field?.path || ""}`.toLowerCase();
  if (/prezzo|offerta|rilancio/.test(text)) {
    return "Il campo economico non era ben leggibile o non e stato riconosciuto con sufficiente confidenza.";
  }
  if (/iban|bic|banc|beneficiario/.test(text)) {
    return "Il campo bancario non e stato trovato: probabile assenza, scrittura errata o OCR non chiaro.";
  }
  if (/catasto|foglio|particella|mappale|subalterno/.test(text)) {
    return "Il dato catastale non e stato trovato o potrebbe essere stato letto male dal documento sorgente.";
  }
  if (/indirizzo|comune|provincia/.test(text)) {
    return "Il dato immobile non era completo o la formattazione dell'indirizzo non era univoca.";
  }
  if (/data|ora|vendita|deposito/.test(text)) {
    return "Il termine temporale non era presente in modo chiaro o non e stato interpretato correttamente.";
  }
  return "Dato non trovato o non letto con sufficiente affidabilita dal documento sorgente.";
}

function buildDocumentQualityReport(event) {
  const result = event?.result || {};
  const missing = Array.isArray(result.missing_fields) ? result.missing_fields : [];
  const issues = missing.map((field) => ({
    title: field.field || field.path || "Campo mancante",
    detail: field.message || "Dato non trovato o mancante.",
    source: field.expected_file || "Documento sorgente",
    responsibility: qualityResponsibility(field),
  }));

  return {
    ok: issues.length === 0,
    issues,
  };
}

function documentEmailSubject(event) {
  return documentDisplayTitle(event);
}

function buildDocumentEmailHtml(event, report) {
  const result = event?.result || {};
  const merged = result.merged || {};
  const code = documentProcedureCode(event);
  const address = [merged.immobile?.indirizzo, merged.immobile?.comune, merged.immobile?.provincia]
    .filter((value) => value && String(value).trim())
    .join(", ");
  const issueRows = report.issues.length
    ? report.issues
        .map(
          (issue) => `
            <tr>
              <td>${escapeHtml(issue.title)}</td>
              <td>${escapeHtml(issue.detail)}</td>
              <td>${escapeHtml(issue.source)}</td>
              <td>${escapeHtml(issue.responsibility)}</td>
            </tr>`
        )
        .join("")
    : `<tr><td colspan="4">Nessuna criticita rilevata dalla pipeline automatica.</td></tr>`;

  return `<!doctype html>
<html lang="it">
  <body style="margin:0;background:#f4f5f7;color:#1f2933;font-family:Arial,Helvetica,sans-serif;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f4f5f7;padding:24px 0;">
      <tr>
        <td align="center">
          <table role="presentation" width="720" cellpadding="0" cellspacing="0" style="width:720px;max-width:calc(100vw - 32px);background:#ffffff;border:1px solid #d9dee7;">
            <tr>
              <td style="padding:28px 36px 18px;">
                <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
                  <tr>
                    <td align="left" style="vertical-align:top;">
                      <img src="cid:astebook-logo@astebook.local" width="177" alt="Astebook" style="display:block;width:177px;max-width:177px;height:auto;border:0;" />
                    </td>
                    <td align="right" style="vertical-align:top;">
                      <img src="cid:iresales-logo@astebook.local" width="177" alt="i-resales" style="display:block;width:177px;max-width:177px;height:auto;border:0;margin-left:auto;" />
                    </td>
                  </tr>
                </table>
              </td>
            </tr>
            <tr>
              <td align="center" style="padding:10px 36px 24px;">
                <div style="font-family:Georgia,serif;font-size:20px;font-weight:700;line-height:1.45;color:#000;">
                  DISCIPLINARE DI GARA<br />
                  PROCEDURA COMPETITIVA<br />
                  MODALITA' ASTA TELEMATICA
                </div>
                <div style="margin-top:12px;font-size:24px;color:#0070c0;">www.astebook.it</div>
              </td>
            </tr>
            <tr>
              <td style="padding:0 36px 28px;">
                <p style="margin:0 0 12px;font-size:15px;line-height:1.55;">In allegato il documento PDF generato per la procedura <strong>${escapeHtml(code)}</strong>.</p>
                <p style="margin:0 0 20px;font-size:14px;color:#4b5563;">${escapeHtml(address || "Immobile non indicato")}</p>
                <h2 style="margin:0 0 10px;font-size:16px;">Report elaborazione automatica</h2>
                <table width="100%" cellpadding="8" cellspacing="0" style="border-collapse:collapse;font-size:13px;">
                  <thead>
                    <tr style="background:#111827;color:#ffffff;text-align:left;">
                      <th>Campo</th>
                      <th>Esito</th>
                      <th>Fonte attesa</th>
                      <th>Responsabilita probabile</th>
                    </tr>
                  </thead>
                  <tbody>${issueRows}</tbody>
                </table>
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
  </body>
</html>`;
}

function buildDocumentEmailText(event, report) {
  const result = event?.result || {};
  const code = documentProcedureCode(event);
  const lines = [`Documento PDF Astebook per procedura ${code}.`, "", "Report elaborazione automatica:"];
  if (!report.issues.length) {
    lines.push("- Nessuna criticita rilevata dalla pipeline automatica.");
  } else {
    report.issues.forEach((issue) => {
      lines.push(`- ${issue.title}: ${issue.detail} Fonte: ${issue.source}. Responsabilita probabile: ${issue.responsibility}`);
    });
  }
  return lines.join("\n");
}

function inlineLogoAttachments({ astebookLogoPath, iresalesLogoPath }) {
  return [
    existsSync(astebookLogoPath)
      ? {
          filename: "astebook-logo.png",
          path: astebookLogoPath,
          cid: "astebook-logo@astebook.local",
          contentType: "image/png",
          contentDisposition: "inline",
        }
      : null,
    existsSync(iresalesLogoPath)
      ? {
          filename: "iresales-logo.png",
          path: iresalesLogoPath,
          cid: "iresales-logo@astebook.local",
          contentType: "image/png",
          contentDisposition: "inline",
        }
      : null,
  ].filter(Boolean);
}

export function createDocumentEmailService(deps) {
  async function sendDocumentEmailForEvent(event, recipients) {
    if (!(await deps.hasSmtpConfig())) {
      throw new Error("SMTP non configurato: imposta SMTP Host e SMTP From.");
    }
    if (!Array.isArray(recipients) || recipients.length === 0) {
      throw new Error("Nessun destinatario configurato in Send to.");
    }
    validateEmailRecipients(recipients);

    const pdf = await deps.buildDocumentPdf(event);
    const report = buildDocumentQualityReport(event);
    const fileName = documentFileName(event, "pdf");
    const smtp = await deps.getSmtpSettings();
    const transporter = await deps.createSmtpTransporter();

    await transporter.sendMail({
      from: smtp.from,
      to: recipients,
      subject: documentEmailSubject(event),
      text: buildDocumentEmailText(event, report),
      html: buildDocumentEmailHtml(event, report),
      attachments: [
        {
          filename: fileName,
          content: pdf,
          contentType: "application/pdf",
        },
        ...inlineLogoAttachments(deps.logoPaths),
      ],
    });

    return {
      status: "sent",
      recipients,
      attachment: fileName,
      report,
    };
  }

  async function autoSendMergedDocumentEmail(eventId) {
    const storedEvent = await deps.getProcessingEvent(eventId);
    if (!storedEvent?.result?.merged) return null;

    const result = storedEvent.result;
    const recipients = parseEmailRecipients(await deps.getEffectiveSetting("DOCUMENT_SEND_TO", "document_send_to"));
    const markResult = async (documentEmail, step) => {
      result.document_email = documentEmail;
      await deps.updateProcessingEvent(eventId, { result }, step);
      return documentEmail;
    };

    if (!recipients.length) {
      return markResult(
        { status: "skipped", reason: "Nessun destinatario configurato in Send to." },
        {
          message: "Automatic document email skipped",
          data: { reason: "missing_recipients" },
        }
      );
    }

    if (!(await deps.hasSmtpConfig())) {
      return markResult(
        { status: "skipped", recipients, reason: "SMTP non configurato: imposta SMTP Host e SMTP From." },
        {
          message: "Automatic document email skipped",
          data: { recipients, reason: "missing_smtp" },
        }
      );
    }

    try {
      const delivery = await sendDocumentEmailForEvent(storedEvent, recipients);
      return markResult(
        {
          status: "sent",
          recipients: delivery.recipients,
          attachment: delivery.attachment,
          report_issues: delivery.report.issues.length,
        },
        {
          message: "Automatic document email sent",
          data: {
            recipients: delivery.recipients,
            attachment: delivery.attachment,
            report_issues: delivery.report.issues.length,
          },
        }
      );
    } catch (error) {
      return markResult(
        {
          status: "failed",
          recipients,
          error: error.message || String(error),
        },
        {
          level: "error",
          message: "Automatic document email failed",
          data: {
            recipients,
            error: error.message || String(error),
          },
        }
      );
    }
  }

  return {
    autoSendMergedDocumentEmail,
    sendDocumentEmailForEvent,
  };
}
