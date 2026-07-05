# Architecture

Astebook currently uses a compact modular backend layout.

```mermaid
flowchart LR
  Client[Automation trigger] --> API[Express API]
  API --> Log[Processing log JSONL]
  API --> AI[OpenAI extraction]
  API --> Maps[Google Maps optional]
  API --> Merge[Merge and normalization logic]
  Merge --> Client
```

## Components

- `server.js`: HTTP API, upload handling, orchestration and response formatting.
- `public/admin`: internal processing UI.
- `lib/processing_log.js`: JSONL runtime log for received and processed events.
- `lib/ai.js`: AI extraction prompts and provider integration.
- `lib/pdf.js`: PDF parsing support.
- `lib/merge_json.js`: domain merge rules.
- `scrapers/`: supporting extraction scripts.

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

- No `/apps/backend` split yet because the service is a single compact backend.
- No PostgreSQL/Prisma yet because the current workflow is stateless.
- No frontend app yet.

These deviations are recorded in `docs/adr/ADR-001-compact-node-service.md`.
