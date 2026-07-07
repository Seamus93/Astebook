# Astebook

Pipeline Node/Express per estrazione e normalizzazione dati da email di attivazione, annuncio e proposta. Endpoint principale: `POST /callAI`.

Il repository e allineato alla baseline organizzativa in `.skills`: pipeline unica GitHub Actions, deploy VPS in `/opt/projects/astebook`, Docker Compose dedicato, healthcheck e documentazione minima.

Struttura principale:

```text
backend/   API, logica estrazione, scrapers, test
frontend/  UI admin statica
runtime/   log e configurazione runtime persistente
```

## Setup Locale

Requisiti:

- Node.js 24+
- npm

Comandi:

```bash
npm install
cp .env.example .env
npm start
```

Variabili principali:

```text
ai_api_key=
GOOGLE_MAPS_API_KEY=
PORT=3000
HOST_PORT=3000
```

## Verifiche

```bash
npm run lint
npm test
npm audit --audit-level=high
npm run ci
```

## Docker

```bash
docker compose build
docker compose up -d
```

Il servizio espone internamente la porta `3000` e pubblica su localhost:

```text
${HOST_PORT:-3000}:3000
```

La cartella `runtime/` e montata come volume locale per conservare log, admin bootstrap e impostazioni tra i redeploy.

## VPS

Path standard:

```text
/opt/projects/astebook
```

Deploy:

- workflow: `.github/workflows/pipeline.yml`
- stack Docker Compose: `astebook`
- servizio/container: `astebook-api`
- registrazione: `/opt/infra/scripts/register-project.sh astebook "$PROJECT_URL" "$HEALTH_URL"`

## Endpoint

### UI Processing

```text
/admin
```

La UI mostra:

- payload ricevuto da Zapier;
- oggetto/mittente/id mail quando presenti;
- metadata file allegati;
- step di elaborazione;
- dati estratti;
- errori di parsing o AI.
- bottone "Visualizza documento" per aprire il disciplinare compilato in PDF.
- bottone "Riprocessa" per rigenerare i dati estratti sugli eventi gia ricevuti.

I log runtime vengono salvati in:

```text
runtime/processing-events.jsonl
runtime/app-config.json
```

Al primo avvio senza `ADMIN_PASSWORD`, apri:

```text
/admin/setup
```

Il primo utente creato diventa admin e viene autenticato automaticamente. Dalla UI admin puoi poi impostare:

- token UI processing;
- token webhook Zapier;
- secret sessione admin;
- nuova password admin.

Le variabili env `ADMIN_*`, `PROCESSING_UI_TOKEN` e `ZAPIER_WEBHOOK_TOKEN` restano supportate e hanno precedenza sui valori runtime.

### `GET /health`

```json
{
  "status": "ok",
  "service": "astebook-api",
  "version": "0.1.0"
}
```

### `POST /callAI`

Supporta JSON e multipart.

Campi principali:

- `email_body_text`: testo annuncio, obbligatorio.
- `codice_pratica`: opzionale.
- `proposta_ocr`, `proposta_text` o `proposta_ocr_text`: testo proposta.
- `proposta_url`, `proposta_base64` o upload file `proposta`: fallback PDF.
- `provvigione_ocr`: opzionale per estrazione percentuale provvigione.

La risposta contiene `codice_pratica` e `merged` con i campi normalizzati.

### `POST /api/v1/zapier/email-activation`

Endpoint di intake per Zapier. Registra mail, body, oggetto, mittente, id run e metadata allegati prima della lavorazione.

L'endpoint prepara anche il payload `result` visibile in UI e restituito a Zapier. Se trova allegati PDF o DOCX riconoscibili come `annuncio` o `proposta`, esegue gli scraper locali e popola `Dati Estratti`.

Se `ZAPIER_WEBHOOK_TOKEN` e configurato, Zapier deve inviarlo nell'header:

```text
x-astebook-webhook-token
```

## Documentazione

- `docs/PROJECT_OVERVIEW.md`
- `docs/ARCHITECTURE.md`
- `docs/API.md`
- `docs/DEPLOYMENT.md`
- `docs/SECURITY.md`
- `docs/GITHUB_ACTIONS.md`
- `docs/SONAR_CONFIGURATION.md`
- `docs/PM_STATUS.md`
- `docs/adr/ADR-001-compact-node-service.md`
