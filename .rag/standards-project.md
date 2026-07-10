# Project Delivery Standard

Updated: 2026-07-10

Sources:

- `.skills/AGENTS.md`
- `.skills/PROJECT_STANDARD.md`

## Mission

AI agents accelerate analysis, design, development, testing, deployment, documentation, maintenance, observability, automation and cost reduction.

## Decision Principles

Prefer:

- simplest maintainable solution;
- lowest reasonable cost;
- documented and observable behavior;
- secure defaults;
- avoiding premature complexity.

Avoid:

- overengineering;
- unnecessary dependencies;
- technology choices without operational value.

## Tier Classification

- Tier 1 - MVP: fast validation, simple architecture, basic monitoring, minimal tests acceptable.
- Tier 2 - Production: stable app for real users; requires tests, monitoring, backup, security, CI/CD.
- Tier 3 - Enterprise: audit, compliance, disaster recovery, full observability, hardening, horizontal scalability.

Every project should identify its tier before implementation.

## Architecture Defaults

- Default architecture: modular monolith.
- Microservices require documented motivation and ADR.
- Default hosting: VPS Linux.
- Default reverse proxy: Nginx.
- Default source control: Git/GitHub.
- Default CI/CD: GitHub Actions.

## Standard Stack Defaults

- Frontend: React, Vite, TypeScript, Tailwind, Shadcn UI, TanStack Query.
- Backend: Node.js, TypeScript, Fastify.
- Database: PostgreSQL.
- ORM: Prisma.
- Cache/Queue: Redis/BullMQ.
- Auth: Better Auth.
- AI: OpenRouter; supports OpenAI, Anthropic, Gemini, DeepSeek.
- Email: Resend; alternatives Postmark.
- Payments: Stripe.
- Storage: S3-compatible, Cloudflare R2, MinIO, AWS S3.

Project-specific deviations should be documented in root `AGENTS.md`, docs, or ADRs.

## Repository Baseline

Baseline expected files for projects using GitHub Actions, Docker Compose and SonarCloud:

- `.github/workflows/pipeline.yml`
- `.github/dependabot.yml`
- `docker-compose.yml`
- `sonar-project.properties`
- `.env.example`
- `README.md`
- `docs/DEPLOYMENT.md`
- `docs/SECURITY.md`
- `docs/GITHUB_ACTIONS.md`
- `docs/SONAR_CONFIGURATION.md`

If a project deviates from the baseline, document the reason in deployment docs or ADR.

## Knowledge Base Workflow

Before implementation, refactor, debugging, deployment or documentation work:

1. Ensure `.rag/` exists.
2. Index or incrementally update:
   - `AGENTS.md`
   - `.skills/AGENTS.md`
   - `.skills/**/*.md` when relevant
   - `docs/**/*.md`
   - `docs/adr/**/*.md`
   - `README.md`
   - `Dockerfile`
   - `docker-compose.yml`
   - `package.json`
   - `.github/workflows/**/*.yml`
   - project config such as `sonar-project.properties`
3. Retrieve only relevant sections.
4. Apply task using retrieved context and directly affected files.
5. Update docs if architecture, deployment, security, API behavior, DB schema or CI/CD changes.
6. Re-index changed docs.

## Documentation Standard

Expected docs include:

- `PROJECT_OVERVIEW.md`
- `ARCHITECTURE.md`
- `ROADMAP.md`
- `API.md`
- `DB_SCHEMA.md`
- `PM_STATUS.md`
- `DEPLOYMENT.md`
- `SECURITY.md`

Visual docs expected where applicable:

- ERD
- User Flow
- System Flow
- Deployment Flow

Use Mermaid or DBML.

## Code Documentation

Non-trivial public functions, handlers, services, shared utilities and scripts should include a searchable spec:

- Purpose
- Inputs
- Returns
- Side Effects
- Errors / Constraints

Keep comments useful and avoid obvious narration.
