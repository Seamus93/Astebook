export function registerCallAiRoute(app, {
  createProcessingEvent,
  runAiExtractionPipeline,
  updateProcessingEvent,
  upload,
}) {
  app.post("/callAI", upload, async (req, res) => {
    let processingEvent = null;
    try {
      const body = Array.isArray(req.body) ? req.body[0] || {} : req.body || {};
      processingEvent = await createProcessingEvent({
        source: "callAI",
        status: "processing",
        body,
        files: req.files,
        metadata: {
          subject: body.subject || body.email_subject || body.oggetto || null,
          from: body.from || body.email_from || body.mittente || null,
          zap_run_id: body.zap_run_id || body.zapRunId || null,
          email_id: body.email_id || body.message_id || body.gmail_id || null,
        },
      });

      const result = await runAiExtractionPipeline({
        body,
        files: req.files,
        eventId: processingEvent.id,
        source: "callAI",
      });

      res.json({
        ok: result.ok,
        event_id: processingEvent.id,
        codice_pratica: result.codice_pratica || "",
        merged: result.merged,
        result,
      });
    } catch (error) {
      console.error("[callAI] error", error);
      if (processingEvent?.id) {
        await updateProcessingEvent(
          processingEvent.id,
          {
            status: "failed",
            error: {
              message: error.message || String(error),
              stack: error.stack || null,
            },
          },
          {
            level: "error",
            message: "Processing failed",
          }
        );
      }
      res.status(500).json({ ok: false, error: error.message || String(error) });
    }
  });
}
