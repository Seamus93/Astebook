# Standards Index

Purpose: navigation file for reusable operational standards in `.skills/`.

## Current Files

- `.skills/AGENTS.md`: short entrypoint and priority order.
- `.skills/PROJECT_STANDARD.md`: mission, decision principles, tiers, architecture, repository baseline, docs, PM outputs.
- `.skills/CI_CD_SECURITY.md`: GitHub Actions, Sonar, Infisical, scans, deploy gates, Git workflow.
- `.skills/VPS_INFRASTRUCTURE.md`: VPS host infrastructure standard.
- `.skills/DATABASE_API_STANDARD.md`: DB schema, migrations, API versioning, CRUD policy.
- `.skills/FRONTEND_STANDARD.md`: frontend stack and UI expectations.
- `.skills/MEDIA_STANDARD.md`: media storage, Cloudinary rules and migration reporting.

## Project-Specific Override Rule

Do not put concrete project names, URLs, ports, app-specific paths or exceptions in reusable `.skills` files. Put those in:

- root `AGENTS.md`
- `docs/`
- `docs/adr/`
- `.rag/` project indexes

## RAG Mirrors

The reusable standards are indexed for fast retrieval in:

- `.rag/standards-index.md`
- `.rag/standards-project.md`
- `.rag/standards-cicd-security.md`
- `.rag/standards-vps.md`
