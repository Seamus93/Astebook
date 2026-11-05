# API

## `GET /health`

Returns service health.

Example response:

```json
{
  "status": "ok",
  "service": "astebook-api",
  "version": "0.1.0"
}
```

## Admin session pages

Server-rendered authentication/setup routes:

- `GET /setup`: first runtime admin setup page when no admin exists.
- `POST /setup`: creates the first runtime admin and starts a session.
- `GET /admin/setup`: redirects to `/setup`.
- `POST /admin/setup`: redirects to `/setup`.
- `GET /login`: admin login page.
- `POST /login`: verifies admin credentials and redirects to `/admin/`.
- `GET /admin/login`: redirects to `/login`.
- `POST /admin/login`: redirects to `/login`.
- `POST /recover-login`: sends or displays admin recovery credentials.
- `GET /logout`: clears admin session.
- `POST /logout`: clears admin session.
- `POST /admin/logout`: clears admin session.
- `GET /admin/*`: protected React admin UI.

## `POST /callAI`

Extracts, enriches and merges auction announcement and proposal data.

Accepted payloads:

- JSON.
- Multipart form data.

Important fields:

- `email_body_text`: required announcement email text.
- `codice_pratica`: optional practice code.
- `proposta_ocr`: optional proposal OCR text.
- `proposta_text`: optional proposal text.
- `proposta_base64`: optional proposal PDF as base64.
- `proposta_url`: optional proposal PDF URL.
- `provvigione_ocr`: optional commission OCR text.

The response contains `codice_pratica` and `merged`.

Every `/callAI` request is also written to PostgreSQL processing event tables with input metadata, extraction steps, final result and errors.

## `POST /api/v1/zapier/email-activation`

Receives the raw activation email payload from Zapier before processing.

Purpose:

- record the email body, subject, sender and Zapier identifiers;
- record attachment metadata;
- make the event visible in the `/admin` UI;
- prepare the result payload that can be returned to Zapier;
- run PDF scraper extraction when supported announcement/proposal attachments are present;
- allow inspection before extraction logic is moved out of Zapier.

The endpoint accepts JSON or multipart form data.

Optional security:

- set `ZAPIER_WEBHOOK_TOKEN` from env or `/admin` settings;
- send it as `x-astebook-webhook-token`.

For public deployments this token is required operationally, even if local development can use a test value.

Example response:

```json
{
  "ok": true,
  "event_id": "uuid",
  "status": "received",
  "admin_url": "/admin/#/events/uuid",
  "result": {
    "mode": "zapier_scraper_preview",
    "ready_for_zapier": false,
    "codice_pratica": "",
    "attachments": [],
    "extracted": {
      "annuncio": null,
      "proposta": null
    },
    "zapier_response": null
  }
}
```

The attachment collector accepts Zapier URLs in nested objects, JSON strings and flattened fields such as `attachment_1_attachment`. When PDF or DOCX attachments are classified as `annuncio` or `proposta`, the endpoint runs the local scrapers and stores the extracted payload in the event `result`.
Documents named as provvigione/commissione are ignored by the proposal scraper so they do not overwrite the actual proposal extraction.

## `GET /api/v1/processing-events`

Returns the latest processing events for the UI.

Optional security:

- set `PROCESSING_UI_TOKEN` from env or `/admin` settings;
- send it as `x-astebook-token`.

The `/admin` browser UI normally uses the login cookie instead of this header.

## `GET /api/v1/processing-events/:id`

Returns the complete event with request payload, file metadata, processing steps, result and error.

## `GET /api/v1/processing-events/:id/extraction-debug`

Returns protected extraction diagnostics for a processing event, including attachment text cache summary, OCR snapshots, proposal agent runs, field matrix and missing fields.

Requires `x-astebook-token` or an authenticated admin UI session.

## `DELETE /api/v1/processing-events/:id`

Deletes one processing event. Returns `404` when the event does not exist.

Requires `x-astebook-token` or an authenticated admin UI session.

## `POST /api/v1/processing-events/:id/feedback`

Stores a human correction for an extracted field in `runtime/extraction-feedback.jsonl`.

Body:

```json
{
  "field_path": "extracted.proposta.indirizzo_immobile",
  "corrected_value": "Via Roma 10, Roma",
  "source_file": "Proposta.pdf",
  "reason": "Dato letto male dall'OCR",
  "apply": true
}
```

By default the correction is also applied to the event `result` at `field_path` and a processing step is logged. Set `apply` to `false` to only save the training example.

## `GET /api/v1/processing-events/:id/document`

Generates a document for one processing event.

Query parameters:

- `format=pdf`: default, returns an inline PDF.
- `format=docx`: returns a DOCX attachment.

Legacy `format=html`, `format=doc` and `format=txt` return `410`.

Requires `x-astebook-token` or an authenticated admin UI session.

## `POST /api/v1/processing-events/:id/send-document`

Sends the generated document email for one processing event.

Body can include:

```json
{ "send_to": "user@example.com" }
```

If no body recipients are provided, Astebook uses `document_send_to`. The endpoint validates SMTP, template and recipient configuration before sending.

Requires `x-astebook-token` or an authenticated admin UI session.

## `GET /api/v1/extraction-feedback`

Returns saved extraction feedback examples for evaluation and prompt improvement. The extraction agents also reuse recent scoped feedback as human-correction context for future `annuncio`, `proposta` and `provvigione` extractions.

Query parameters:

- `event_id`: optional event filter.
- `limit`: optional max results, default `200`.

## `GET /api/v1/extraction-feedback/summary`

Returns auto-learning dataset metrics for the admin console:

- total validated corrections.
- correction counts by extraction scope.
- most corrected fields.
- most recent corrections.

## `GET /api/v1/extraction-feedback/context`

Returns the prompt-memory context generated from validated feedback.

Query parameters:

- `scope`: optional `annuncio`, `proposta` or `provvigione`.
- `limit`: optional max examples, default `8`.

## `GET /api/v1/admin/settings`

Returns redacted runtime settings for the logged-in admin.

Query parameters:

- `reveal=1`: returns stored values for the protected admin settings UI.

## `POST /api/v1/admin/settings`

Updates runtime settings for:

- `processing_ui_token`
- `zapier_webhook_token`
- `admin_session_secret`
- `ai_api_key`, `ai_base_url`, `ai_model`: AI provider settings.
- `ai_memory_enabled`: `true` lets extraction prompts use validated human corrections.
- `ai_memory_examples_limit`: max recent correction examples injected per extraction scope.
- `geocoder_provider`: address enrichment provider. Supported values are `nominatim`, `google` and `none`.
- `nominatim_base_url`, `nominatim_user_agent`: Nominatim endpoint and identifying User-Agent used when `geocoder_provider=nominatim`.
- `pdf_app_api_key`, `pdf_app_ocr_endpoint`, `pdf_app_job_endpoint`: OCR provider settings.
- `pdf_app_async_mode`, `pdf_app_poll_timeout_ms`, `pdf_app_poll_interval_base_ms`, `pdf_app_retry_count`, `pdf_app_retry_base_delay_ms`: optional PDF-app async, polling and legacy retry controls.
- `pdf_app_ocr_timeout_ms`, `pdf_app_ocr_max_attempts`, `pdf_app_ocr_retry_base_ms`, `pdf_app_ocr_retry_max_ms`: optional PDF-app OCR request timeout and retry/backoff controls.
- `document_template_url`: Google Docs/DOCX template URL used for document generation.
- `document_send_to`: comma, semicolon or newline separated default recipients for document PDF emails.
- `smtp_host`, `smtp_port`, `smtp_secure`, `smtp_user`, `smtp_password`, `smtp_from`: SMTP delivery settings used when matching environment variables are not set.
- `email_watcher_enabled`: `true` enables the VPS email watcher.
- `email_watcher_imap_host`, `email_watcher_imap_port`, `email_watcher_imap_secure`: IMAP connection settings. If the host is empty, Astebook derives it from `smtp_host` where possible, for example `smtp.gmail.com` -> `imap.gmail.com`.
- `email_watcher_from_allowlist`: comma, semicolon or newline separated sender allowlist.
- `email_watcher_required_filename`: required substring in at least one attachment filename, for example `proposta`. The default `proposta` also accepts proposal-equivalent filenames such as `offerta irrevocabile` and `offerta d'acquisto`.
- `email_watcher_poll_seconds`: polling interval, minimum runtime value is 30 seconds.
- `mailbox_auto_process_enabled`: `true` enables the cronjob that starts pipeline processing for indexed mailbox rows.
- `mailbox_auto_process_interval_seconds`: cron interval, minimum runtime value is 30 seconds.
- `mailbox_auto_process_limit`: maximum mailbox rows processed in one cron batch.
- `admin_password`

These endpoints require the `/admin` login cookie.

## `GET /api/v1/ocr-inputs/:token/:fileName`

Serves a temporary OCR input file created from an attachment buffer.

This route is intentionally unauthenticated because PDF-app must fetch the file by URL. The token is random and sensitive; logs must mask it. The response returns the stored content type, content length and `Cache-Control: private, max-age=3600`.

## Address geocoding

Address enrichment defaults to Nominatim. The geocoder is used after extraction to complete address context such as comune, provincia, CAP and formatted address when the source text is incomplete.

Operational notes:

- Nominatim results are cached in `runtime/geocode-cache.json`.
- The public Nominatim service is throttled to at most one request per second by the backend.
- Set `geocoder_provider=none` to disable network geocoding.
- Set `geocoder_provider=google` to use Google geocoding when `GOOGLE_MAPS_API_KEY` is configured.

## Automatic PDF email delivery

After a Zapier activation has been received, extracted and merged, the backend automatically generates the PDF document and sends it by email to `document_send_to`.

Requirements:

- SMTP must be configured through settings or environment variables with host and sender.
- `DOCUMENT_TEMPLATE_URL` or the runtime document template setting must be configured.
- `document_send_to` must contain one or more valid email addresses.

The email includes the generated PDF and an Astebook-styled processing report with missing fields, extraction notes and likely responsibility hints. The delivery result is stored in `result.document_email` and logged in the processing event.

## VPS email watcher

When `email_watcher_enabled=true`, Astebook connects to the configured IMAP mailbox and indexes processable activation emails into the DB-backed mailbox list. Processing is started separately by the admin Process button or by the mailbox auto-process cronjob.

The project-specific mailbox behavior, sidebar loading rules, watcher state, auto-process candidate query and cutover notes live in `docs/MAILBOX.md`.

When an activation email contains an Immobiliare.it announcement URL and the configured scraper returns data, the normalized Immobiliare/Apify payload becomes the primary `extracted.annuncio` source for fields it can provide, such as address, description, price, availability, surface and property type. AI/email/PDF extraction is retained in `fallback_annuncio`, so if Apify is unavailable, rate limited or returns incomplete data, the pipeline still uses the best fallback extracted from the original inputs.

## `POST /api/v1/admin/email-watcher/scan`

Runs one immediate IMAP watcher scan using the current watcher settings and filters. Requires the `/admin` login cookie.

The response includes scan counters: `scanned`, `accepted`, `duplicates`, `skipped_sender` and `skipped_filename`; `accepted` means indexed into the mailbox DB for later processing. It also returns recent `diagnostics` for skipped unread messages, including subject, sender and attachment filenames.

## `POST /api/v1/admin/email-watcher/state/reset`

Resets persisted email watcher state. Requires the `/admin` login cookie.

## `POST /api/v1/admin/email-watcher/state/forget`

Removes one message id from persisted email watcher state. Requires the `/admin` login cookie.

Body:

```json
{ "message_id": "<message-id>" }
```

## `GET /api/v1/admin/mailbox/messages`

Returns indexed mailbox messages for the admin sidebar. Requires the `/admin` login cookie.

Query parameters:

- `limit`: max rows, default `50`.
- `q`: optional text search.
- `from`: optional sender filter.
- `include_all_senders=1`: include explicitly disallowed senders.

## `GET /api/v1/admin/email-watcher/messages`

Alias for `GET /api/v1/admin/mailbox/messages`.

## `POST /api/v1/admin/mailbox/sync`

Starts mailbox IMAP sync/backfill in the background. Requires the `/admin` login cookie.

Body can include:

```json
{
  "from": "sender@example.com",
  "include_all_senders": true,
  "limit": 30,
  "q": "",
  "days_back": 21
}
```

Returns `202` with current sync state.

## `GET /api/v1/admin/mailbox/sync/status`

Returns current or latest mailbox sync status. Requires the `/admin` login cookie.

## `POST /api/v1/admin/mailbox/messages/process`

Processes one indexed mailbox message through the email activation pipeline. Requires the `/admin` login cookie.

Body can include:

```json
{
  "uid": 123,
  "message_id": "<message-id>"
}
```

Returns `202` when processing is accepted.

## `POST /api/v1/admin/mailbox/auto-process/run`

Runs one immediate mailbox auto-process batch. Requires the `/admin` login cookie.

The scheduled version uses the `mailbox_auto_process_*` settings and calls the same backend path as the Process button for each eligible mailbox row.

## `GET /api/v1/admin/mailbox/auto-process/status`

Returns mailbox auto-process runtime status. Requires the `/admin` login cookie.

## `POST /api/v1/processing-events/:id/reprocess`

Before restarting extraction, the endpoint verifies that AI, OCR, document template and email delivery settings are complete. If configuration is missing, it returns `400` with `missing_configuration` and does not start the pipeline.

Body can include:

```json
{ "skip_auto_send": true }
```

When `skip_auto_send` is true, Astebook reruns OCR/AI/merge but does not send the generated document email.
