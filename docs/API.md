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

Every `/callAI` request is also written to the processing log with input metadata, extraction steps, final result and errors.

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

## `GET /api/v1/admin/settings`

Returns redacted runtime settings for the logged-in admin.

## `POST /api/v1/admin/settings`

Updates runtime settings for:

- `processing_ui_token`
- `zapier_webhook_token`
- `admin_session_secret`
- `document_send_to`: comma, semicolon or newline separated default recipients for document PDF emails.
- `admin_password`

These endpoints require the `/admin` login cookie.

## Automatic PDF email delivery

After a Zapier activation has been received, extracted and merged, the backend automatically generates the PDF document and sends it by email to `document_send_to`.

Requirements:

- SMTP environment must be configured with `SMTP_HOST` and `SMTP_FROM`.
- `DOCUMENT_TEMPLATE_URL` or the runtime document template setting must be configured.
- `document_send_to` must contain one or more valid email addresses.

The email includes the generated PDF and an Astebook-styled processing report with missing fields, extraction notes and likely responsibility hints. The delivery result is stored in `result.document_email` and logged in the processing event.
