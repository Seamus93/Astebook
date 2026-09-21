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
- Timeout OCR: la POST iniziale a PDF-app usa `PDF_APP_OCR_TIMEOUT_MS`, default `120000`. Un timeout locale viene diagnosticato come `client_timeout`, distinto da una risposta reale `HTTP 504` diagnosticata come `http_504`.
- Retry PDF-app: limitato a `408`, `429`, `500`, `502`, `503`, `504`, timeout client e reset di rete. Non viene fatto retry su `400`, `401`, `403`, `404` o errori di configurazione/schema chiaramente permanenti.
- Backoff PDF-app: exponential backoff con jitter leggero; se PDF-app restituisce `Retry-After` su una risposta retryable, Astebook lo rispetta entro un limite massimo prudente.
- Single-flight OCR: nello stesso processo Node, richieste concorrenti per lo stesso hash allegato condividono la stessa chiamata PDF-app. Non e un lock distribuito fra piu processi/container.
- Polling async PDF-app verificato: dopo un `job_id`, Astebook chiama `PDF_APP_JOB_ENDPOINT=https://api.pdf-app.net/async_jobid_check` con metodo `GET` e body JSON `{"job_id":"..."}`. PDF-app richiede il body anche se il metodo e `GET`.
- Compatibilita endpoint job generici: fuori dal contratto PDF-app verificato, Astebook mantiene il comportamento legacy `{jobId}` oppure append del job id al path.

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
ocr_attempt_count: 3
ocr_attempts: [{ attempt: 1, result: "http_504", duration_ms: 30000, retryable: true, retry_delay_ms: 2100 }]
mode: "sync"
final_status: "ocr_failed" | "ocr_retry_exhausted"
final_error_type: "http_504" | "client_timeout" | "network_reset"
error_type: "ocr_infrastructure"
```

Non vengono loggati:

- `PDF_APP_API_KEY`;
- token temporaneo completo;
- header `Authorization`.

In caso di OCR async completato, `ocr_summary.files[...].pdf_app_diagnostics` puo includere:

```text
ocr_provider: "pdf-app"
ocr_mode: "async"
ocr_start_status: 202
ocr_job_id: "..."
ocr_poll_attempts: 3
ocr_final_status: "success"
ocr_text_length: 12345
ocr_pages: 9
credits_consumed: 47.63
ocr_duration_ms: 2623
ocr_status: "completed"
mode: "async"
final_status: "ocr_completed" | "ocr_empty" | "ocr_suspicious" | "ocr_failed"
initial_request_duration_ms: 123
request_duration_ms: 123
attempts: 1
ocr_attempt_count: 1
ocr_attempts: []
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

`ocr_suspicious` e un warning non bloccante per testo OCR molto corto; `ocr_empty` blocca l'estrazione AI del documento. Se PDF-app restituisce `status:"success"` ma il testo estratto da `extraction_results[]` e vuoto/whitespace, Astebook diagnostica `reason:"ocr_empty_result"` e non salva cache OCR valida.

## Contratto PDF-app Async Verificato

START:

```http
POST https://api.pdf-app.net/ocr
Content-Type: application/json
Accept: application/json
Authorization: <PDF_APP_API_KEY>
```

`Authorization` usa la chiave raw, senza prefisso `Bearer`.

Payload:

```json
{
  "versionMode": "2",
  "v2rawText": true,
  "v2Layout": false,
  "v2Forms": true,
  "v2Signatures": true,
  "async": true,
  "pdfConvertZoomFactor": 1,
  "zoom_factor_img": 1,
  "fileUrls": ["<ASTEEBOOK OCR INPUT URL>"]
}
```

Risposta attesa:

```json
{
  "message": "Async job started, check job_id status later",
  "job_id": "..."
}
```

POLL:

```http
GET https://api.pdf-app.net/async_jobid_check
Content-Type: application/json
Accept: application/json
Authorization: <PDF_APP_API_KEY>
```

Body JSON obbligatorio anche su `GET`:

```json
{
  "job_id": "..."
}
```

Non usare `GET /async_jobid_check/<jobId>` e non usare query string `?job_id=...`.

COMPLETED:

```json
{
  "statusCode": 200,
  "status": "success",
  "message": "OCR completed successfully.",
  "CreditzConsumed": 47.63,
  "extraction_results": [
    {
      "v2": true,
      "result": [
        { "page": 1, "result": "..." }
      ]
    }
  ]
}
```

Astebook concatena tutte le pagine in `extraction_results[].result[]`, ordinate per `page` e poi per `region_index` quando presente.

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
- `PDF_APP_OCR_TIMEOUT_MS` / `pdf_app_ocr_timeout_ms`: timeout locale della singola richiesta HTTP OCR, default `120000`.
- `PDF_APP_OCR_MAX_ATTEMPTS` / `pdf_app_ocr_max_attempts`: massimo tentativi OCR totali, default `3`. Ha precedenza sul conteggio legacy.
- `PDF_APP_OCR_RETRY_BASE_MS` / `pdf_app_ocr_retry_base_ms`: base backoff OCR, default derivato da `PDF_APP_RETRY_BASE_DELAY_MS` o `1000`.
- `PDF_APP_OCR_RETRY_MAX_MS` / `pdf_app_ocr_retry_max_ms`: cap del backoff OCR, default `30000`.

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
