# Reusable Standards Index

Purpose: reusable operational standards extracted from `.skills/`. These notes are intended to travel across projects and must not contain project-specific configuration.

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

- `.skills/AGENTS.md`: short priority/order entrypoint.
- `.skills/PROJECT_STANDARD.md`: tiering, architecture, repo structure, docs, PM outputs.
- `.skills/CI_CD_SECURITY.md`: GitHub Actions, Sonar, Infisical, scans, deploy gates.
- `.skills/VPS_INFRASTRUCTURE.md`: host layout, reverse proxy, shared infra, registration.
- `.skills/DATABASE_API_STANDARD.md`: DB schema, migrations, API versioning, CRUD policy.
- `.skills/FRONTEND_STANDARD.md`: UI/frontend expectations.
- `.skills/MEDIA_STANDARD.md`: media storage and Cloudinary rules.

Keep concrete project names, URLs, ports, local deploy paths and exceptions out of reusable `.skills` and `.rag/standards-*` files. Put them in root `AGENTS.md`, docs, ADRs, or project RAG files.

## Retrieval Queries

- Global standard: `rg -n "Tier|Architecture|Repository|Knowledge|Documentation" .skills .rag/standards-*`
- VPS standard: `rg -n "VPS|/opt/infra|register-project|Uptime Kuma|Nginx|Homepage" .skills .rag/standards-*`
- CI/CD/security: `rg -n "pipeline|Sonar|Trivy|Gitleaks|Infisical|DEPLOY_HOST|VPS_APP_DIR" .skills .rag/standards-*`
- Project-vs-standard separation: `rg -n "project-specific|override|specifico|riusabile" .skills .rag/standards-*`
