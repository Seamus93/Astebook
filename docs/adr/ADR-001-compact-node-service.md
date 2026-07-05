# ADR-001 - Compact Node Service

## Status

Accepted.

## Context

The standard repository structure supports larger modular monoliths with `/apps`, `/packages`, Prisma and frontend/backend separation.

Astebook currently provides one stateless Node/Express API for document automation. Introducing a full monorepo split now would add structure without immediate operational value.

## Decision

Keep the current compact Node service layout while adding the standard repository baseline:

- single GitHub Actions pipeline;
- Docker Compose compliance;
- VPS deployment rules;
- documentation baseline;
- health endpoint and smoke test;
- SonarCloud and security scan configuration.

## Consequences

- The repository remains simple while becoming deployable under the VPS standard.
- Future persistence, frontend, queues or backoffice modules can introduce `/apps`, `/packages`, Prisma and Redis through dedicated ADRs.
- This ADR documents the intentional deviation from the full AgriAvenger-style monorepo structure.
