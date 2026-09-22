# Shared RAG Standards Index

Updated: 2026-09-22

Purpose: reusable retrieval index for standards shared across projects. This folder must not contain project-specific product, provider, endpoint, schema or operational details.

## Shared Files

- `.rag/standards-index.md`: reusable standard entrypoint and retrieval queries.
- `.rag/standards-project.md`: project tiering, architecture, repository structure, documentation and quality expectations.
- `.rag/standards-cicd-security.md`: GitHub Actions, Infisical, Sonar, security scans, deploy gates and secret handling.
- `.rag/standards-vps.md`: VPS layout, Docker, reverse proxy, shared monitoring and project registration.

## Project-Specific Knowledge

Project-specific implementation maps belong outside `.rag`, normally in:

- `AGENTS.md`
- `docs/`
- `docs/adr/`
- `docs/ai-context/` or another project-local docs folder

Examples of project-specific material that does not belong in shared `.rag`:

- OCR provider contracts;
- mailbox or product-specific ingestion flows;
- concrete Prisma models and migrations;
- concrete deployment paths, ports and project names;
- app-specific frontend module maps.

## Retrieval Queries

- Shared standards: `rg -n "Tier|Architecture|Repository|Documentation|Knowledge" .skills .rag`
- CI/CD security: `rg -n "GitHub Actions|Infisical|Sonar|Trivy|Gitleaks|deploy gate" .skills .rag`
- VPS standards: `rg -n "VPS|Nginx|Docker|register-project|Uptime Kuma|Homepage" .skills .rag`
- Project context: `rg -n "api|backend|frontend|database|deploy|diagnostic|ADR" AGENTS.md docs`
