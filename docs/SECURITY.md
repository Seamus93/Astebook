# Security

## Secret Management

Secrets must not be committed.

Runtime configuration can be provided through environment variables, Infisical/GitHub Actions secrets, or the persisted self-hosted config file.

Required local template:

- `.env.example`

Ignored local file:

- `.env`

## Admin UI

The `/admin` processing UI is protected by a server-side login.

If `ADMIN_PASSWORD` is configured, env-managed auth is used:

- `ADMIN_USERNAME`
- `ADMIN_PASSWORD`
- `ADMIN_SESSION_SECRET`

If `ADMIN_PASSWORD` is not configured, the first visit to `/admin/setup` creates the runtime admin and logs it in automatically. The runtime settings are stored in:

```text
runtime/app-config.json
```

Environment variables override runtime settings when both are present.

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
- The Docker service publishes `${HOST_PORT:-3000}:3000` for the current test deployment.
- Keep `runtime/` mounted as a Docker volume so admin credentials and settings survive redeploys.
- Shared infrastructure tools must not be installed by this repository.
- Set `PROCESSING_UI_TOKEN` from the admin UI or env before exposing processing APIs outside a trusted network.
- Set `ZAPIER_WEBHOOK_TOKEN` from the admin UI or env before exposing `/api/v1/zapier/email-activation`.
- If the VPS email watcher is enabled, store the mailbox app password as `smtp_password` runtime setting or `EMAIL_WATCHER_IMAP_PASSWORD` environment secret. Prefer a provider app password over the account's primary password.
