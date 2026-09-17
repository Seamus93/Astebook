# PDF-app OCR Diagnostics

Documento temporaneo per isolare il `403 Forbidden` restituito da PDF-app OCR senza cambiare provider, pipeline AI, endpoint pubblici o configurazione di rete.

## Audit Codice

- Payload PDF-app: `backend/lib/pdf_app.js`, funzione `buildPdfAppOcrPayload`.
- Lettura `PDF_APP_API_KEY`: `backend/lib/pdf_app.js`, funzione `ocrFileUrlWithPdfApp`, tramite `getEffectiveSetting("PDF_APP_API_KEY", "pdf_app_api_key")`.
- Endpoint OCR: `backend/lib/pdf_app.js`, `getEffectiveSetting("PDF_APP_OCR_ENDPOINT", "pdf_app_ocr_endpoint")`.
- Endpoint job async: `backend/lib/pdf_app.js`, `getEffectiveSetting("PDF_APP_JOB_ENDPOINT", "pdf_app_job_endpoint")`.
- Modalita async: default `auto`; usa `async:true` solo quando `PDF_APP_JOB_ENDPOINT` e configurato. `PDF_APP_ASYNC_MODE=true` forza async, `false` forza sync.
- Costruzione `fileUrls`: `backend/lib/extraction_pipeline.js`, dentro `extractAttachmentText`; se l'allegato non ha gia un URL, usa `createOcrInputFromBuffer`.
- Generazione token temporaneo: `backend/lib/ocr_input_store.js`, funzione `createOcrInputFromBuffer`; token random UUID senza trattini.
- Route download file temporaneo: `backend/server.js`, `GET /api/v1/ocr-inputs/:token/:fileName`.
- TTL token: diagnostico, default `3600` secondi (`OCR_INPUT_TTL_SECONDS` opzionale). La route attuale non applica scadenza hard; espone `cache-control: private, max-age=3600`.
- Redirect: non sono previsti redirect nella route Express.
- Content-Type restituito: `backend/server.js` usa `input.mime_type` letto dal metadata file.
- Autenticazione route OCR input: nessuna autenticazione applicativa, perche PDF-app deve poter scaricare il file dal solo URL temporaneo.
- Gestione errori PDF-app: `backend/lib/pdf_app.js`; su risposta non 2xx viene sollevato errore con diagnostica sicura, senza API key e senza token completo.
- Retry PDF-app: limitato a `502`, `503`, `504` e timeout/reset di rete. Non viene fatto retry su `400`, `401`, `403` o errori di configurazione.
- Polling async: dopo un job id, Astebook chiama `PDF_APP_JOB_ENDPOINT`, sostituendo `{jobId}` se presente oppure accodando il job id al path.

## Diagnostica Sicura Nei Log

I log standard non devono stampare il token completo. I campi ammessi sono:

```text
OCR URL Origin: http://31.220.76.233:3000
OCR URL Path: /api/v1/ocr-inputs/abcd***91ef/file.pdf
OCR URL Expires At: 2026-07-30T...
OCR Content Type: application/pdf
OCR File Size: 1234567
```

In caso di errore PDF-app non 2xx, la diagnostica ammessa include:

```text
status: 403
endpoint: https://api.pdf-app.net/ocr
version_mode: 2
file_urls_count: 1
file_url_origins: ["http://31.220.76.233:3000"]
file_url_schemes: ["http"]
file_url_ports: ["3000"]
file_url_paths: ["/api/v1/ocr-inputs/abcd***91ef/file.pdf"]
response_body: "..."
request_duration_ms: 1234
attempts: 3
mode: "sync"
final_status: "ocr_failed"
error_type: "ocr_infrastructure"
```

Non vengono loggati:

- `PDF_APP_API_KEY`;
- token temporaneo completo;
- header `Authorization`.

In caso di OCR async completato, `ocr_summary.files[...].pdf_app_diagnostics` puo includere:

```text
mode: "async"
final_status: "ocr_completed" | "ocr_empty" | "ocr_suspicious" | "ocr_failed"
initial_request_duration_ms: 123
request_duration_ms: 123
attempts: 1
poll_attempts: 2
poll_http_attempts: 2
poll_duration_ms: 2500
total_duration_ms: 2623
text_length: 3416
non_whitespace_length: 2980
quality: "ok" | "empty" | "suspicious"
reason: null | "ocr_text_empty" | "ocr_text_short"
page_count: 3
```

`ocr_suspicious` e un warning non bloccante per testo OCR molto corto; `ocr_empty` blocca l'estrazione AI del documento.

## Configurazione Runtime PDF-app

Variabili/supporti runtime:

- `PDF_APP_API_KEY` / `pdf_app_api_key`: chiave PDF-app.
- `PDF_APP_OCR_ENDPOINT` / `pdf_app_ocr_endpoint`: endpoint `/ocr`.
- `PDF_APP_JOB_ENDPOINT` / `pdf_app_job_endpoint`: endpoint polling job async.
- `PDF_APP_ASYNC_MODE` / `pdf_app_async_mode`: `auto` default, `true`, `false`.
- `PDF_APP_POLL_TIMEOUT_MS` / `pdf_app_poll_timeout_ms`: default `90000`.
- `PDF_APP_POLL_INTERVAL_BASE_MS` / `pdf_app_poll_interval_base_ms`: default `1000`.
- `PDF_APP_RETRY_COUNT` / `pdf_app_retry_count`: default `2`, quindi massimo 3 tentativi totali.
- `PDF_APP_RETRY_BASE_DELAY_MS` / `pdf_app_retry_base_delay_ms`: default `1000`.

## Self-Test URL Astebook

Il self-test e disattivato di default.

Attivazione:

```bash
OCR_INPUT_SELF_TEST=true
```

Quando attivo, dopo la generazione dell'URL temporaneo Astebook il sistema prova a leggerlo via HTTP e registra:

- status code;
- `Content-Type`;
- `Content-Length`;
- redirect;
- durata;
- verifica header `%PDF` per PDF.

Il test usa redirect manuale e non segue automaticamente eventuali risposte `3xx`, cosi un redirect verso login, HTML o proxy risulta visibile in diagnostica senza mascherare il problema.

## Test Manuale URL Astebook

Da eseguire copiando il full URL temporaneo da una diagnostica admin protetta, non dai log standard:

```bash
curl -I '<FULL_TEMP_URL>'
curl -L -o /tmp/ocr-test.pdf '<FULL_TEMP_URL>'
file /tmp/ocr-test.pdf
ls -lh /tmp/ocr-test.pdf
```

Risultato atteso:

- HTTP `200`;
- `Content-Type: application/pdf`;
- dimensione non zero;
- nessun login;
- nessun redirect verso una pagina HTML.

## Test Manuale PDF-app Con PDF Pubblico HTTPS

Usare:

```bash
node scripts/test_pdf_app_ocr.js
```

Lo script usa la stessa `PDF_APP_API_KEY` configurata e invia a PDF-app un PDF HTTPS pubblico noto con lo stesso payload OCR reale.
Non stampa la API key. Se serve cambiare PDF pubblico:

```bash
PDF_APP_TEST_PUBLIC_URL='https://example.com/file.pdf' node scripts/test_pdf_app_ocr.js
```

## Classificazione Finale

CASE A

PDF pubblico HTTPS + stessa key = `403`.

Conclusione: problema API key, account, piano o endpoint PDF-app.

CASE B

PDF pubblico HTTPS = `200`, Astebook temp URL self-test = `200`, PDF-app con Astebook URL = `403`.

Conclusione probabile: restrizione PDF-app su `http`, IP, porta o accessibilita di `fileUrls`.

CASE C

Astebook temp URL self-test diverso da `200`.

Conclusione: endpoint temporaneo Astebook non accessibile correttamente.

CASE D

Astebook temp URL self-test = `200` ma `Content-Type` diverso da `application/pdf`.

Conclusione: problema endpoint/file response Astebook.
