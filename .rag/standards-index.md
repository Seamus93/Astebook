# Reusable Standards Index

Updated: 2026-07-10

Purpose: reusable operational standards extracted from `.skills/AGENTS.md` and `.skills/VPS_INFRASTRUCTURE.md`. These notes are intended to travel across projects, unlike the Astebook-specific RAG files.

## Source Files

- `.skills/AGENTS.md`: global agent/project delivery standard.
- `.skills/VPS_INFRASTRUCTURE.md`: VPS host infrastructure standard.
- `AGENTS.md`: current project override for Astebook only.

## Priority Model

For any project:

1. Project-specific requirements and root `AGENTS.md`.
2. Reusable standards in `.skills/`.
3. ADRs in `docs/adr`.
4. Framework conventions.
5. Agent preferences.

## Reusable Standard Index Files

- `.rag/standards-project.md`: project tiering, architecture, repository structure, documentation, RAG workflow and quality expectations.
- `.rag/standards-cicd-security.md`: GitHub Actions, Sonar, Infisical, security scans, deploy gates, secret handling.
- `.rag/standards-vps.md`: VPS layout, Docker, reverse proxy, Uptime Kuma, Homepage, project registration.

## `.skills` Split

`.skills/AGENTS.md` is the short entrypoint. Focused standard files:

- `.skills/AGENTS.md`: short priority/order entrypoint.
- `.skills/PROJECT_STANDARD.md`: tiering, architecture, repo structure, docs, PM outputs.
- `.skills/CI_CD_SECURITY.md`: GitHub Actions, Sonar, Infisical, scans, deploy gates.
- `.skills/VPS_INFRASTRUCTURE.md`: host layout, reverse proxy, shared infra, registration.
- `.skills/DATABASE_API_STANDARD.md`: DB schema, migrations, API versioning, CRUD policy.
- `.skills/FRONTEND_STANDARD.md`: UI/frontend expectations.
- `.skills/MEDIA_STANDARD.md`: media storage and Cloudinary rules.

Keep project-specific values out of reusable `.skills` files. Put concrete project names, URLs, ports and exceptions in root `AGENTS.md`, docs, ADRs, or project RAG files.

## Retrieval Queries

- Global standard: `rg -n "Tier|Architecture|Repository|Knowledge|Documentation" .skills .rag/standards-*`
- VPS standard: `rg -n "VPS|/opt/infra|register-project|Uptime Kuma|Nginx|Homepage" .skills .rag/standards-*`
- CI/CD/security: `rg -n "pipeline|Sonar|Trivy|Gitleaks|Infisical|DEPLOY_HOST|VPS_APP_DIR" .skills .rag/standards-*`
- Project-vs-standard separation: `rg -n "project-specific|Astebook|reusable|override" .rag`
