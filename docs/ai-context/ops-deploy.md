# Ops/Deploy Knowledge

Updated: 2026-07-10

## Deployment Model

- Tier 2 production service.
- VPS path: `/opt/projects/astebook`.
- Shared infra remains outside repo under `/opt/infra`.
- Deploy target is a Docker Compose stack with service/container `astebook-api`.
- Runtime state is persisted via `./runtime:/app/runtime`.
- Every deploy must run `docker compose up -d --build`.
- Deploy job must fail if remote worktree is dirty.
- Deploy job must call `/opt/infra/scripts/register-project.sh`.

## Docker

- `Dockerfile`: multi-stage Node 24 Alpine build/runtime.
- Build stage runs `npm ci` and `npm run build`.
- Runtime installs `curl`, `libreoffice`, `ttf-dejavu`.
- Runtime copies:
  - `/app/backend`
  - `/app/frontend/dist`
  - `/app/frontend/media`
  - `/app/scripts`
- Exposes port `3000`.
- `docker-compose.yml` publishes `127.0.0.1:3010:3000` for test access.
- Healthcheck: `curl -f http://localhost:3000/health`, interval 30s, timeout 10s, retries 3.

## GitHub Actions Requirements

Single workflow:

- `.github/workflows/pipeline.yml`

Required Secrets:

- `DEPLOY_HOST`
- `DEPLOY_USER`
- `DEPLOY_KEY`
- `SONAR_TOKEN`
- `INFISICAL_CLIENT_ID`
- `INFISICAL_CLIENT_SECRET`

Required Variables:

- `VPS_APP_DIR`, expected `/opt/projects/astebook`
- `PROJECT_URL`
- `HEALTH_URL`
- `SONAR_ORGANIZATION`, expected `seamus93`
- `INFISICAL_PROJECT_ID`
- `INFISICAL_ENV`
- `INFISICAL_IDENTITY_ID` optional for OIDC

## CI/CD Rules

- Run CI, SonarCloud and security on `main`, `test`, PRs and manual dispatch.
- Deploy only on push to `main`.
- Fetch Infisical secrets with OIDC when `INFISICAL_IDENTITY_ID` is configured.
- Fallback Infisical auth uses `INFISICAL_CLIENT_ID` and `INFISICAL_CLIENT_SECRET`.
- Security gates include npm audit, Gitleaks, Trivy filesystem/image scans and SonarCloud.

## Runtime Security

- `/admin` is protected by server-side login.
- If env admin secrets are absent, `/admin/setup` creates the first runtime admin.
- Env variables override runtime settings.
- `PROCESSING_UI_TOKEN` protects processing APIs when cookie login is not used.
- `ZAPIER_WEBHOOK_TOKEN` protects `/api/v1/zapier/email-activation`.
- Public traffic should enter through host Nginx reverse proxy.

## Useful Commands

- Local start: `npm start`.
- Alternate local port: `npm run start:4000`.
- Frontend dev: `npm run frontend:dev`.
- Build: `npm run build`.
- CI locally: `npm run ci`.
- Tests: `npm test`.

## Pipeline remediation 2026-11-09

- Sources: package.json/package-lock.json, .github/workflows/pipeline.yml, sonar-project.properties, docs/SONAR_CONFIGURATION.md.
- Run 42070312239: CI/CodeQL passed; npm audit failed on 11 vulnerabilities (4 high, 3 critical); Sonar JsSecuritySensorV2 stalled after 84% and timed out at 32 minutes.
- Remediation in progress: compatible dependency fixes without --force; retain audit and security analysis. Verify clean npm install, tests and build before publishing.

Validation: npm ci and production build pass; npm audit reports zero vulnerabilities. Local suite reached 126 tests, with database-backed HTTP cases failing because the clean install has no generated Prisma client and this workstation has no running Docker/PostgreSQL. Full DB integration validation remains assigned to CI, which generates Prisma and migrates its disposable PostgreSQL service. Source Compose binding and workflow YAML validation pass. Sonar completion remains unverified until the new remote scan finishes.
