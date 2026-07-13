import { buildDocumentDocx, buildDocumentPdf } from "../lib/document_builder.js";
import { documentFileName } from "../lib/document_naming.js";
import { parseEmailRecipients } from "../lib/settings_validation.js";

function valueAtPath(obj, path) {
  return String(path || "")
    .split(".")
    .filter(Boolean)
    .reduce((current, key) => current?.[key], obj);
}

function setValueAtPath(obj, path, value) {
  const parts = String(path || "").split(".").filter(Boolean);
  if (!parts.length) throw new Error("field_path obbligatorio.");
  if (parts.some((part) => ["__proto__", "prototype", "constructor"].includes(part))) {
    throw new Error("field_path non valido.");
  }
  let current = obj;
  parts.slice(0, -1).forEach((part) => {
    if (!current[part] || typeof current[part] !== "object" || Array.isArray(current[part])) current[part] = {};
    current = current[part];
  });
  current[parts[parts.length - 1]] = value;
}

export function registerProcessingEventRoutes(app, {
  appendExtractionFeedback,
  buildExtractionFeedbackContext,
  collectDocumentEmailConfigurationIssues,
  collectPipelineConfigurationIssues,
  getEffectiveSetting,
  getProcessingEvent,
  listExtractionFeedback,
  listProcessingEvents,
  requireProcessingUiToken,
  runAiExtractionPipeline,
  sendDocumentEmailForEvent,
  summarizeExtractionFeedback,
  updateProcessingEvent,
}) {
  app.get("/api/v1/processing-events", requireProcessingUiToken, async (req, res) => {
    const limit = Number(req.query.limit || 100);
    const events = await listProcessingEvents({ limit });
    res.json({ ok: true, events });
  });

  app.get("/api/v1/processing-events/:id", requireProcessingUiToken, async (req, res) => {
    const event = await getProcessingEvent(req.params.id);
    if (!event) {
      res.status(404).json({ ok: false, error: "Processing event not found" });
      return;
    }
    res.json({ ok: true, event });
  });

  app.get("/api/v1/extraction-feedback/summary", requireProcessingUiToken, async (req, res) => {
    const summary = await summarizeExtractionFeedback({
      limit: Number(req.query.limit || 500),
    });
    res.json({ ok: true, summary });
  });

  app.get("/api/v1/extraction-feedback/context", requireProcessingUiToken, async (req, res) => {
    const scope = String(req.query.scope || "").trim();
    const context = await buildExtractionFeedbackContext({
      scope,
      limit: Number(req.query.limit || 8),
    });
    res.json({ ok: true, scope: scope || null, context });
  });

  app.get("/api/v1/extraction-feedback", requireProcessingUiToken, async (req, res) => {
    const feedback = await listExtractionFeedback({
      limit: Number(req.query.limit || 200),
      eventId: req.query.event_id || undefined,
    });
    res.json({ ok: true, feedback });
  });

  app.post("/api/v1/processing-events/:id/feedback", requireProcessingUiToken, async (req, res) => {
    const event = await getProcessingEvent(req.params.id);
    if (!event) {
      res.status(404).json({ ok: false, error: "Processing event not found" });
      return;
    }

    try {
      const feedback = await appendExtractionFeedback({ event, feedback: req.body || {} });
      let updatedEvent = event;
      if (req.body?.apply !== false) {
        const result = structuredClone(event.result || {});
        const oldValue = valueAtPath(result, feedback.field_path);
        setValueAtPath(result, feedback.field_path, feedback.corrected_value);
        updatedEvent = await updateProcessingEvent(
          event.id,
          { result },
          {
            message: "Human extraction feedback saved",
            data: {
              field_path: feedback.field_path,
              old_value: oldValue === undefined ? null : oldValue,
              corrected_value: feedback.corrected_value,
              feedback_id: feedback.id,
            },
          }
        );
      }
      res.status(201).json({ ok: true, feedback, event: updatedEvent });
    } catch (error) {
      res.status(400).json({ ok: false, error: error.message || String(error) });
    }
  });

  app.get("/api/v1/processing-events/:id/document", requireProcessingUiToken, async (req, res) => {
    const event = await getProcessingEvent(req.params.id);
    if (!event) {
      res.status(404).json({ ok: false, error: "Processing event not found" });
      return;
    }

    const format = String(req.query.format || "pdf").toLowerCase();
    const fileName = documentFileName(event, format === "doc" ? "doc" : format);

    if (format === "html") {
      res.status(410).json({
        ok: false,
        error: "Formato legacy non supportato. Usa format=pdf o format=docx con DOCUMENT_TEMPLATE_URL.",
      });
      return;
    }

    if (format === "doc") {
      res.status(410).json({
        ok: false,
        error: "Formato legacy non supportato. Usa format=docx.",
      });
      return;
    }

    if (format === "docx") {
      try {
        const docx = await buildDocumentDocx(event);
        if (!docx) {
          res.status(400).json({ ok: false, error: "DOCUMENT_TEMPLATE_URL non configurato." });
          return;
        }
        res.setHeader("content-type", "application/vnd.openxmlformats-officedocument.wordprocessingml.document");
        res.setHeader("content-disposition", `attachment; filename="${documentFileName(event, "docx")}"`);
        res.send(docx);
      } catch (error) {
        res.status(500).json({
          ok: false,
          error: "Generazione DOCX fallita.",
          detail: error.message || String(error),
        });
      }
      return;
    }

    if (format === "txt") {
      res.status(410).json({
        ok: false,
        error: "Formato legacy non supportato. Usa format=pdf o format=docx.",
      });
      return;
    }

    try {
      const pdf = await buildDocumentPdf(event);
      res.setHeader("content-type", "application/pdf");
      res.setHeader("content-disposition", `inline; filename="${fileName}"`);
      res.send(pdf);
    } catch (error) {
      res.status(500).json({
        ok: false,
        error: "Generazione PDF fallita.",
        detail: error.message || String(error),
      });
    }
  });

  app.post("/api/v1/processing-events/:id/send-document", requireProcessingUiToken, async (req, res) => {
    const event = await getProcessingEvent(req.params.id);
    if (!event) {
      res.status(404).json({ ok: false, error: "Processing event not found" });
      return;
    }

    if (!event.result?.merged) {
      res.status(400).json({
        ok: false,
        error: "Dati merged non disponibili.",
        detail: "Completa prima una lavorazione o usa Reprocessa per generare i dati merged.",
      });
      return;
    }

    const bodyRecipients = parseEmailRecipients(req.body?.send_to || req.body?.to);
    const configuredRecipients = parseEmailRecipients(
      await getEffectiveSetting("DOCUMENT_SEND_TO", "document_send_to")
    );
    const recipients = bodyRecipients.length ? bodyRecipients : configuredRecipients;
    const configurationIssues = await collectDocumentEmailConfigurationIssues(recipients);
    if (configurationIssues.length) {
      res.status(400).json({
        ok: false,
        error: "Non sono state configurate queste cose",
        missing_configuration: configurationIssues,
      });
      return;
    }

    try {
      const delivery = await sendDocumentEmailForEvent(event, recipients);
      const result = {
        ...(event.result || {}),
        document_email: {
          status: "sent",
          recipients: delivery.recipients,
          attachment: delivery.attachment,
          sent_at: new Date().toISOString(),
          manual: true,
        },
      };

      await updateProcessingEvent(
        event.id,
        { result },
        {
          message: "Document email sent",
          data: {
            recipients: delivery.recipients,
            attachment: delivery.attachment,
            report_issues: delivery.report.issues.length,
          },
        }
      );

      res.json({
        ok: true,
        recipients: delivery.recipients,
        attachment: delivery.attachment,
        report: delivery.report,
      });
    } catch (error) {
      const result = {
        ...(event.result || {}),
        document_email: {
          status: "failed",
          recipients,
          error: error.message || String(error),
          failed_at: new Date().toISOString(),
          manual: true,
        },
      };
      await updateProcessingEvent(
        event.id,
        { result },
        {
          level: "error",
          message: "Document email failed",
          data: {
            recipients,
            error: error.message || String(error),
          },
        }
      );
      res.status(500).json({
        ok: false,
        error: "Invio documento fallito.",
        detail: error.message || String(error),
      });
    }
  });

  app.post("/api/v1/processing-events/:id/reprocess", requireProcessingUiToken, async (req, res) => {
    const event = await getProcessingEvent(req.params.id);
    if (!event) {
      res.status(404).json({ ok: false, error: "Processing event not found" });
      return;
    }

    if (!["zapier.email_activation", "imap.email_activation"].includes(event.source)) {
      res.status(400).json({ ok: false, error: "Reprocess disponibile solo per eventi email." });
      return;
    }

    const configurationIssues = await collectPipelineConfigurationIssues();
    if (configurationIssues.length) {
      res.status(400).json({
        ok: false,
        error: "Non sono state configurate queste cose",
        missing_configuration: configurationIssues,
      });
      return;
    }

    const body = event.request?.body || {};
    await updateProcessingEvent(
      event.id,
      {
        status: "received",
        result: null,
        error: null,
      },
      { message: "Manual reprocess requested" }
    );
    const result = await runAiExtractionPipeline({
      body,
      files: [],
      eventId: event.id,
      source: event.source || "zapier.email_activation",
      skipAutoSend: req.body?.skip_auto_send === true,
    });
    const updatedEvent = await getProcessingEvent(event.id);

    res.json({
      ok: true,
      event: updatedEvent,
      result,
    });
  });
}
