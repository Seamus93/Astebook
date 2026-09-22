# Development Specs Knowledge

Updated: 2026-09-22

Purpose: map the development specifications that future AI agents should read before changing Astebook.

## Spec Sources and Priority

Read in this order:

1. User/project request in the current conversation.
2. Root `AGENTS.md`: Astebook-specific tier, repo shape, CI/CD and runtime constraints.
3. `.skills/AGENTS.md`: reusable agent standards entrypoint and mandatory knowledge-base workflow.
4. `docs/adr/*.md`: architectural decisions.
5. `.skills/*.md`: reusable standards for project delivery, CI/CD, VPS, database/API, frontend and media.
6. `docs/ai-context/*.md`: project-local fast retrieval maps.
7. `.rag/*.md`: shared reusable standards only.
7. Framework and codebase conventions.

## Project-Specific Specs

- `AGENTS.md`: Astebook production tier, GitHub Actions requirements, deploy/runtime rules and protected admin constraints.
- `docs/adr/ADR-001-compact-node-service.md`: accepted decision to keep a minimal frontend/backend split instead of a heavier monorepo layout.
- `docs/PROJECT_OVERVIEW.md`: product scope and service purpose.
- `docs/ARCHITECTURE.md`: system architecture overview.
- `docs/API.md`: endpoints and runtime API behavior.
- `docs/DB_SCHEMA.md`: database schema and migration policy.
- `docs/DEPLOYMENT.md`: deployment process and operational commands.
- `docs/GITHUB_ACTIONS.md`: CI/CD workflow behavior.
- `docs/SECURITY.md`: security and secret-handling rules.
- `docs/ROADMAP.md` and `docs/PM_STATUS.md`: planning/status context.

## Reusable Standards

- `.skills/PROJECT_STANDARD.md`: tier model, repository baseline, documentation standard and code documentation standard.
- `.skills/CI_CD_SECURITY.md`: pipeline, Infisical, Sonar, scanning and deploy gates.
- `.skills/VPS_INFRASTRUCTURE.md`: VPS layout, Nginx, monitoring and project registration.
- `.skills/DATABASE_API_STANDARD.md`: schema, migrations, API versioning and CRUD policy.
- `.skills/FRONTEND_STANDARD.md`: admin/backoffice UI expectations.
- `.skills/MEDIA_STANDARD.md`: media storage and migration rules.

## Code Documentation Spec

Non-trivial public functions, handlers, service functions, shared utilities and CLI scripts should have a searchable spec when changed or introduced:

```text
Purpose:
Inputs:
Returns:
Side Effects:
Errors / Constraints:
```

Use this where it adds durable understanding. Avoid obvious comments that merely restate the code.

## Architecture Decision Specs

Current ADR:

- `docs/adr/ADR-001-compact-node-service.md`

Key decision:

- Astebook remains one deployable Node/Express service with `backend/` and `frontend/`, plus root Docker/package/CI files.
- New app/package layers should be introduced only when they provide operational value and should be documented by a new ADR.

## Verification Specs

Default commands:

- Lint/syntax: `npm run lint`
- Backend tests: `npm test`
- Build: `npm run build`
- DB migrations: `npm run db:migrate`
- Prisma client: `npm run db:generate`

Known local caveat:

- Server/API tests that hit Prisma-backed processing-event routes need `DATABASE_URL`; without it, Prisma can fail with `Environment variable not found: DATABASE_URL`.

## Change Documentation Rules

Update docs and RAG when changes affect:

- architecture or ADR decisions;
- deployment/CI/CD/security;
- API behavior or runtime settings;
- database schema or migrations;
- OCR/provider contracts;
- mailbox ingestion behavior;
- frontend admin workflow or settings UX.

## Retrieval Queries

- Spec priority: `rg -n "Priority Order|Mandatory Project Knowledge Base|Knowledge Base Workflow|ADR|Code Documentation" AGENTS.md .skills .rag docs`
- Code documentation template: `rg -n "Purpose:|Inputs:|Returns:|Side Effects:|Errors / Constraints" .skills .rag docs backend frontend scripts`
- ADRs: `rg -n "Status|Context|Decision|Consequences" docs/adr .rag`
- Runtime/deploy rules: `rg -n "deploy|VPS_APP_DIR|register-project|Infisical|health|admin" AGENTS.md docs .rag .github`
- Frontend standards: `rg -n "Frontend|backoffice|admin|settings|responsive|overlap" .skills/FRONTEND_STANDARD.md docs/ai-context/frontend-admin.md frontend/src`

## Related AI Context Maps

- `.rag/index.md` for shared standards
- `docs/ai-context/backend-api.md`
- `docs/ai-context/frontend-admin.md`
- `docs/ai-context/database-prisma.md`
- `docs/ai-context/mailbox-ingestion.md`
- `docs/ai-context/ocr-pdf-app.md`
- `docs/ai-context/scripts-diagnostics.md`
- `docs/ai-context/ops-deploy.md`
