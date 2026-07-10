# Astebook RAG Index

Updated: 2026-07-10

Purpose: lightweight project knowledge base for quick retrieval with `rg`.

## Project Snapshot

- Tier: 2 - Production.
- Product: Node/Express automation service for real-estate auction activation emails, proposal documents, OCR fields, AI extraction, merge/normalization and document email delivery.
- Runtime state: JSON files under `runtime/`, mounted by Docker Compose.
- Frontend: React/Vite admin UI served by backend under `/admin`.
- Backend: single Express service in `backend/server.js` plus focused helpers in `backend/lib`.
- Deployment: VPS Docker Compose stack at `/opt/projects/astebook`; public traffic should go through host Nginx; temporary service port is `3000`.

## Index Files

- `.rag/frontend-admin.md`: admin UI modules, settings modal, event detail rendering, current refactor targets.
- `.rag/backend-api.md`: Express endpoints, Zapier intake, processing log, AI/OCR/document/email flow, dedupe notes.
- `.rag/ops-deploy.md`: Docker, GitHub Actions, Infisical, security, runtime settings and deploy constraints.

## Required Source Coverage

Indexed source classes:

- `AGENTS.md`
- `.skills/AGENTS.md`
- `docs/**/*.md`
- `docs/adr/**/*.md`
- `README.md`
- `Dockerfile`
- `docker-compose.yml`
- `package.json`
- `.github/workflows/**/*.yml`
- `sonar-project.properties`
- directly affected source files under `frontend/src` and `backend`

## High-Value Retrieval Queries

- Admin settings UI: `rg -n "settings|documentSendTo|recipient|ConsoleAdmin|settingsPane" frontend/src .rag`
- Event detail UI: `rg -n "selectEvent|renderPipelineSteps|fileStepGroups|workflow" frontend/src .rag`
- Zapier intake: `rg -n "email-activation|zapier|email_id|duplicate|webhook" backend .rag`
- Runtime config: `rg -n "app-config|runtime settings|getEffectiveSetting|admin settings" backend docs .rag`
- Deploy: `rg -n "VPS_APP_DIR|docker compose|register-project|Infisical|health" docs .github .rag`

## Current Notes

- `frontend/src/adminClient.js` has been reduced to a thin initializer; admin UI behavior now lives in `frontend/src/admin/*`.
- `backend/server.js` is the orchestration hub. Prefer adding helper modules in `backend/lib` when new behavior is standalone.
- Zapier is currently the email intake bridge, but the intended direction is VPS-only email intake with internal IMAP/Gmail watcher and runtime dedupe.
