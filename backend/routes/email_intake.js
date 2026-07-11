export function createEmailIntakeHandlers({
  createProcessingEvent,
  findProcessingEventByExternalEmailId,
  getProcessingEvent,
  runAiExtractionPipeline,
  updateProcessingEvent,
}) {
  async function handleZapierEmailActivation(req, res) {
    let event = null;
    try {
      const body = Array.isArray(req.body) ? req.body[0] || {} : req.body || {};
      const externalEmailId = body.email_id || body.message_id || body.gmail_id || null;
      const duplicateEvent = await findProcessingEventByExternalEmailId({
        source: "zapier.email_activation",
        emailId: externalEmailId,
      });
      if (duplicateEvent) {
        res.status(202).json({
          ok: true,
          duplicate: true,
          event_id: duplicateEvent.id,
          status: duplicateEvent.status,
          admin_url: `/admin/#/events/${duplicateEvent.id}`,
          result: duplicateEvent.result,
        });
        return;
      }

      event = await createProcessingEvent({
        source: "zapier.email_activation",
        status: "received",
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
        eventId: event.id,
        source: "zapier.email_activation",
      });
      const updatedEvent = await getProcessingEvent(event.id);

      res.status(202).json({
        ok: true,
        event_id: event.id,
        status: updatedEvent?.status || event.status,
        admin_url: `/admin/#/events/${event.id}`,
        result,
      });
    } catch (error) {
      if (event?.id) {
        await updateProcessingEvent(
          event.id,
          {
            status: "failed",
            error: {
              message: error.message || String(error),
              stack: error.stack || null,
            },
          },
          {
            level: "error",
            message: "Zapier intake processing failed",
          }
        );
      }
      res.status(500).json({ ok: false, error: error.message || String(error) });
    }
  }

  async function processEmailWatcherActivation({ body, files, metadata }) {
    const emailId = body.email_id || body.message_id || body.gmail_id || metadata?.email_id || null;
    const duplicateEvent = await findProcessingEventByExternalEmailId({
      source: "imap.email_activation",
      emailId,
    });
    if (duplicateEvent) return duplicateEvent;

    const event = await createProcessingEvent({
      source: "imap.email_activation",
      status: "received",
      body,
      files,
      metadata: {
        subject: metadata?.subject || body.subject || null,
        from: metadata?.from || body.from || null,
        zap_run_id: null,
        email_id: emailId,
      },
    });

    try {
      await runAiExtractionPipeline({
        body,
        files,
        eventId: event.id,
        source: "imap.email_activation",
      });
    } catch (error) {
      await updateProcessingEvent(
        event.id,
        {
          status: "failed",
          error: {
            message: error.message || String(error),
            stack: error.stack || null,
          },
        },
        {
          level: "error",
          message: "Email watcher processing failed",
        }
      );
    }

    return getProcessingEvent(event.id);
  }

  return {
    handleZapierEmailActivation,
    processEmailWatcherActivation,
  };
}

export function registerEmailIntakeRoutes(app, {
  handleZapierEmailActivation,
  requireZapierWebhookToken,
  upload,
}) {
  app.post("/api/v1/zapier/email-activation", requireZapierWebhookToken, upload, handleZapierEmailActivation);
}
