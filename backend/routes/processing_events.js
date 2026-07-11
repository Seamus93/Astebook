import { buildDocumentDocx, buildDocumentPdf } from "../lib/document_builder.js";
import { parseEmailRecipients } from "../lib/settings_validation.js";

export function registerProcessingEventRoutes(app, {
  collectDocumentEmailConfigurationIssues,
  collectPipelineConfigurationIssues,
  getEffectiveSetting,
  getProcessingEvent,
  listProcessingEvents,
  requireProcessingUiToken,
  runAiExtractionPipeline,
  sendDocumentEmailForEvent,
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

  app.get("/api/v1/processing-events/:id/document", requireProcessingUiToken, async (req, res) => {
    const event = await getProcessingEvent(req.params.id);
    if (!event) {
      res.status(404).json({ ok: false, error: "Processing event not found" });
      return;
    }

    const format = String(req.query.format || "pdf").toLowerCase();
    const fileName = `astebook-${event.id}.${format === "doc" ? "doc" : format}`;

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
        res.setHeader("content-disposition", `attachment; filename="astebook-${event.id}.docx"`);
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
    });
    const updatedEvent = await getProcessingEvent(event.id);

    res.json({
      ok: true,
      event: updatedEvent,
      result,
    });
  });
}
