# Astebook Agent Standard

## Project Tier

Tier 2 - Production.

Astebook is a Node/Express automation service that extracts and normalizes real-estate auction data from activation emails, proposal text/PDFs, and OCR fields.

## Priority Order

1. Project requirements.
2. `.skills/AGENTS.md`.
3. ADR files in `docs/adr`.
4. Framework conventions.
5. Agent preferences.

## Repository Structure

Current repository layout:

```text
/.github
/.skills
/docs
/docs/adr
/lib
/scripts
/scrapers
/tests
Dockerfile
docker-compose.yml
package.json
server.js
```

The repository is intentionally a compact backend service. Deviations from the full monorepo baseline are documented in `docs/adr/ADR-001-compact-node-service.md`.

## Required GitHub Actions Configuration

Secrets:

- `DEPLOY_HOST`
- `DEPLOY_USER`
- `DEPLOY_KEY`
- `SONAR_TOKEN`
- `INFISICAL_CLIENT_ID`
- `INFISICAL_CLIENT_SECRET`

Variables:

- `VPS_APP_DIR`: expected `/opt/projects/astebook`
- `PROJECT_URL`: public Astebook URL
- `HEALTH_URL`: public `/health` URL
- `SONAR_ORGANIZATION`: expected `seamus93`
- `INFISICAL_PROJECT_ID`
- `INFISICAL_ENV`
- `INFISICAL_IDENTITY_ID` optional for OIDC

## CI/CD Rules

- Use a single workflow: `.github/workflows/pipeline.yml`.
- Run CI, SonarCloud and security checks on `main`, `test`, PRs and manual dispatch.
- Deploy only on push to `main`.
- Fetch Infisical secrets with OIDC when `INFISICAL_IDENTITY_ID` is configured.
- Deploy target is the VPS project directory from `VPS_APP_DIR`.
- Every deploy must run `docker compose up -d --build` so a push to `main` rebuilds the Docker service.
- The deploy job must fail if the remote worktree is dirty.
- The deploy job must call `/opt/infra/scripts/register-project.sh`.

## Runtime Rules

- HTTP health endpoint: `GET /health`.
- Public traffic must enter through the host Nginx reverse proxy.
- The Docker service currently exposes port `3000` publicly for test access.
- `/admin` must stay protected by server-side login before any public exposure.
- Shared infrastructure such as Portainer, Uptime Kuma, Grafana, Homepage, Cockpit, Prometheus and Loki must remain outside this repository.
