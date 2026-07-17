# Architecture

Astebook uses a minimal frontend/backend split.

```mermaid
flowchart LR
  Client[Automation trigger] --> API[Express API]
  API --> DB[PostgreSQL via Prisma]
  API --> Log[Processing log JSONL]
  API --> AI[OpenAI extraction]
  API --> Maps[Google Maps optional]
  API --> Merge[Merge and normalization logic]
  Merge --> Client
```

## Components

- `backend/server.js`: HTTP API, upload handling, orchestration and response formatting.
- `backend/lib/app_config.js`: first-admin bootstrap plus DB-backed runtime settings in production.
- `backend/lib/db.js`: Prisma client for PostgreSQL-backed state.
- `backend/lib/processing_log.js`: JSONL runtime log for received and processed events.
- `backend/lib/ai.js`: AI extraction prompts and provider integration.
- `backend/lib/pdf.js`: PDF parsing support.
- `backend/lib/merge_json.js`: domain merge rules.
- `backend/scrapers/`: supporting extraction scripts.
- `backend/tests/`: backend/API tests.
- `frontend/admin`: internal processing UI served by the backend under `/admin`.

## Deployment Flow

```mermaid
flowchart TD
  Push[Push to main] --> CI[CI]
  CI --> Sonar[SonarCloud]
  CI --> Security[Security scans]
  Sonar --> Deploy[Deploy VPS]
  Security --> Deploy
  Deploy --> Docker[Docker Compose stack astebook]
  Docker --> Register[register-project.sh]
```

## Current Intentional Deviations

- No `/apps` or `/packages` layer yet because the project is still one deployable service.
- Processing event logs still use JSONL while mailbox listing, runtime settings and related operational tables are being moved to PostgreSQL/Prisma.
- The frontend is static admin UI, not a separate SPA build pipeline.

These deviations are recorded in `docs/adr/ADR-001-compact-node-service.md`.
