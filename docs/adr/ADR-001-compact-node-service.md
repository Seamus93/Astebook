# ADR-001 - Minimal Frontend/Backend Service

## Status

Accepted.

## Context

The standard repository structure supports larger modular monoliths with `/apps`, `/packages`, Prisma and frontend/backend separation.

Astebook now has both a Node/Express automation API and a small admin processing UI. A full monorepo split would still add structure without immediate operational value, but separating visual assets from backend code improves clarity.

## Decision

Use a minimal split:

- `backend/` for API, domain logic, scrapers and backend tests;
- `frontend/` for visual/admin UI assets;
- root-level Docker, package and CI files for the single deployable service.

Keep the standard repository baseline:

- single GitHub Actions pipeline;
- Docker Compose compliance;
- VPS deployment rules;
- documentation baseline;
- health endpoint and smoke test;
- SonarCloud and security scan configuration.

## Consequences

- The repository stays simple while separating frontend and backend responsibilities.
- Future persistence, queues or larger backoffice modules can introduce `/apps`, `/packages`, Prisma and Redis through dedicated ADRs.
- This ADR documents the intentional deviation from a heavier monorepo structure.
