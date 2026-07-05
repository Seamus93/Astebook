# Security

## Secret Management

Secrets must not be committed.

Runtime configuration is provided through environment variables and Infisical/GitHub Actions secrets.

Required local template:

- `.env.example`

Ignored local file:

- `.env`

## Admin UI

The `/admin` processing UI is protected by a server-side login.

Required production variables:

- `ADMIN_USERNAME`
- `ADMIN_PASSWORD`
- `ADMIN_SESSION_SECRET`

If `ADMIN_PASSWORD` is not configured, `/admin` returns a setup error and does not expose the UI.

## Required GitHub Secrets

- `DEPLOY_HOST`
- `DEPLOY_USER`
- `DEPLOY_KEY`
- `SONAR_TOKEN`
- `INFISICAL_CLIENT_ID`
- `INFISICAL_CLIENT_SECRET`

## Required GitHub Variables

- `VPS_APP_DIR`
- `PROJECT_URL`
- `HEALTH_URL`
- `SONAR_ORGANIZATION`
- `INFISICAL_PROJECT_ID`
- `INFISICAL_ENV`
- `INFISICAL_IDENTITY_ID` optional

## Pipeline Security

The standard pipeline runs:

- npm audit with `high` threshold.
- Gitleaks.
- Trivy filesystem scan.
- Trivy Docker image scan.
- SonarCloud analysis.

Critical and high findings block deploy.

## Runtime

- The app should be exposed through host Nginx.
- The Docker service binds to localhost by default.
- Shared infrastructure tools must not be installed by this repository.
- Set `PROCESSING_UI_TOKEN` before exposing `/admin` outside a trusted network.
- Set `ZAPIER_WEBHOOK_TOKEN` before exposing `/api/v1/zapier/email-activation`.
