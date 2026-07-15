import { redactSecret } from "../lib/settings_validation.js";

export function registerAdminSettingsRoutes(app, {
  createAdminSession,
  getAdminLoginUsername,
  getRuntimeSettings,
  requireAdminSession,
  setAdminSessionCookie,
  updateRuntimeSettings,
}) {
  app.get("/api/v1/admin/settings", requireAdminSession, async (req, res) => {
    const settings = await getRuntimeSettings();
    const reveal = req.query.reveal === "1" || req.query.reveal === "true";
    const secretValue = (envName, runtimeName) => {
      const value = process.env[envName] || settings[runtimeName];
      return reveal ? value || "" : redactSecret(value);
    };

    res.json({
      ok: true,
      admin: {
        username: await getAdminLoginUsername(),
        env_managed: Boolean(process.env.ADMIN_PASSWORD),
      },
      settings: {
        processing_ui_token: secretValue("PROCESSING_UI_TOKEN", "processing_ui_token"),
        zapier_webhook_token: secretValue("ZAPIER_WEBHOOK_TOKEN", "zapier_webhook_token"),
        admin_session_secret: secretValue("ADMIN_SESSION_SECRET", "admin_session_secret"),
        ai_api_key: secretValue("AI_API_KEY", "ai_api_key"),
        ai_base_url: secretValue("AI_BASE_URL", "ai_base_url"),
        ai_model: secretValue("AI_MODEL", "ai_model"),
        ai_memory_enabled:
          process.env.AI_MEMORY_ENABLED || settings.ai_memory_enabled || "true",
        ai_memory_examples_limit:
          process.env.AI_MEMORY_EXAMPLES_LIMIT || settings.ai_memory_examples_limit || "8",
        geocoder_provider:
          process.env.GEOCODER_PROVIDER || settings.geocoder_provider || "nominatim",
        nominatim_base_url:
          process.env.NOMINATIM_BASE_URL || settings.nominatim_base_url || "https://nominatim.openstreetmap.org",
        nominatim_user_agent:
          process.env.NOMINATIM_USER_AGENT || settings.nominatim_user_agent || "Astebook/0.1 (https://astebook.it)",
        pdf_app_api_key: secretValue("PDF_APP_API_KEY", "pdf_app_api_key"),
        pdf_app_ocr_endpoint:
          process.env.PDF_APP_OCR_ENDPOINT || settings.pdf_app_ocr_endpoint || "",
        pdf_app_job_endpoint:
          process.env.PDF_APP_JOB_ENDPOINT || settings.pdf_app_job_endpoint || "",
        document_template_url:
          process.env.DOCUMENT_TEMPLATE_URL || settings.document_template_url || "",
        document_send_to:
          process.env.DOCUMENT_SEND_TO || settings.document_send_to || "",
        smtp_host: secretValue("SMTP_HOST", "smtp_host"),
        smtp_port: process.env.SMTP_PORT || settings.smtp_port || "587",
        smtp_secure: process.env.SMTP_SECURE || settings.smtp_secure || "false",
        smtp_user: secretValue("SMTP_USER", "smtp_user"),
        smtp_password: secretValue("SMTP_PASSWORD", "smtp_password"),
        smtp_from: process.env.SMTP_FROM || settings.smtp_from || "",
        email_watcher_enabled:
          process.env.EMAIL_WATCHER_ENABLED || settings.email_watcher_enabled || "false",
        email_watcher_imap_host:
          process.env.EMAIL_WATCHER_IMAP_HOST || settings.email_watcher_imap_host || "",
        email_watcher_imap_port:
          process.env.EMAIL_WATCHER_IMAP_PORT || settings.email_watcher_imap_port || "993",
        email_watcher_imap_secure:
          process.env.EMAIL_WATCHER_IMAP_SECURE || settings.email_watcher_imap_secure || "true",
        email_watcher_from_allowlist:
          process.env.EMAIL_WATCHER_FROM_ALLOWLIST || settings.email_watcher_from_allowlist || "",
        email_watcher_required_filename:
          process.env.EMAIL_WATCHER_REQUIRED_FILENAME || settings.email_watcher_required_filename || "proposta",
        email_watcher_poll_seconds:
          process.env.EMAIL_WATCHER_POLL_SECONDS || settings.email_watcher_poll_seconds || "120",
        immobiliare_scraper_provider:
          process.env.IMMOBILIARE_SCRAPER_PROVIDER || settings.immobiliare_scraper_provider || "direct",
        apify_token: secretValue("APIFY_TOKEN", "apify_token"),
        apify_immobiliare_actor_id:
          process.env.APIFY_IMMOBILIARE_ACTOR_ID || settings.apify_immobiliare_actor_id || "",
        apify_immobiliare_input_template:
          process.env.APIFY_IMMOBILIARE_INPUT_TEMPLATE || settings.apify_immobiliare_input_template || "",
      },
    });
  });

  app.post("/api/v1/admin/settings", requireAdminSession, async (req, res) => {
    const body = req.body || {};
    const settings = {};
    const assignIfFilled = (bodyKey, settingsKey = bodyKey) => {
      const value = body[bodyKey];
      if (typeof value === "string" && value.trim()) settings[settingsKey] = value.trim();
    };

    assignIfFilled("processing_ui_token");
    assignIfFilled("zapier_webhook_token");
    assignIfFilled("admin_session_secret");
    assignIfFilled("ai_api_key");
    assignIfFilled("ai_base_url");
    assignIfFilled("ai_model");
    assignIfFilled("ai_memory_enabled");
    assignIfFilled("ai_memory_examples_limit");
    assignIfFilled("geocoder_provider");
    assignIfFilled("nominatim_base_url");
    assignIfFilled("nominatim_user_agent");
    assignIfFilled("pdf_app_api_key");
    assignIfFilled("pdf_app_ocr_endpoint");
    assignIfFilled("pdf_app_job_endpoint");
    assignIfFilled("document_template_url");
    assignIfFilled("smtp_host");
    assignIfFilled("smtp_port");
    assignIfFilled("smtp_secure");
    assignIfFilled("smtp_user");
    assignIfFilled("smtp_password");
    assignIfFilled("smtp_from");
    assignIfFilled("apify_token");
    [
      "email_watcher_enabled",
      "email_watcher_imap_host",
      "email_watcher_imap_port",
      "email_watcher_imap_secure",
      "email_watcher_from_allowlist",
      "email_watcher_required_filename",
      "email_watcher_poll_seconds",
      "immobiliare_scraper_provider",
      "apify_immobiliare_actor_id",
      "apify_immobiliare_input_template",
    ].forEach((key) => {
      if (Object.prototype.hasOwnProperty.call(body, key)) {
        settings[key] = String(body[key] || "").trim();
      }
    });
    if (Object.prototype.hasOwnProperty.call(body, "document_send_to")) {
      settings.document_send_to = String(body.document_send_to || "").trim();
    }

    await updateRuntimeSettings({
      settings,
      admin_password: body.admin_password ? String(body.admin_password) : undefined,
    });

    if (body.admin_session_secret || body.admin_password) {
      const session = await createAdminSession(await getAdminLoginUsername());
      setAdminSessionCookie(res, session);
    }

    res.json({ ok: true });
  });
}
