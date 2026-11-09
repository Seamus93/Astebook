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

If `ADMIN_PASSWORD` is not configured, the first visit to `/admin/setup` creates the runtime admin and logs it in automatically. With PostgreSQL enabled, UI runtime settings are stored in:

```text
runtime_settings
```

Local/dev runs without `DATABASE_URL` use `runtime/app-config.json` as a fallback.

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
- The Docker service publishes `127.0.0.1:3010:3000` for the current test deployment.
- Keep `runtime/` mounted as a Docker volume so admin credentials and settings survive redeploys.
- Shared infrastructure tools must not be installed by this repository.
- Set `PROCESSING_UI_TOKEN` from the admin UI or env before exposing processing APIs outside a trusted network.
- Set `ZAPIER_WEBHOOK_TOKEN` from the admin UI or env before exposing `/api/v1/zapier/email-activation`.
- If the VPS email watcher is enabled, store the mailbox app password as `smtp_password` runtime setting or `EMAIL_WATCHER_IMAP_PASSWORD` environment secret. Prefer a provider app password over the account's primary password.


## Standard porte VPS (2026-11-05)

Configurazione operativa aggiornata: `127.0.0.1:3010:3000`. Questa assegnazione sostituisce le precedenti indicazioni di accesso diretto sulla porta 3000. Nginx e HTTPS sono gestiti manualmente sulla VPS. Vedere [piano e rollback](VPS_PORT_MIGRATION.md).


## Pipeline remediation — 2026-11-09

The compatible dependency lockfile refresh removes the npm audit findings that blocked deployment (no forced major upgrades). CI retains `npm audit --audit-level=high`, Trivy and Gitleaks. Sonar scan action is upgraded from v6 to v8.4.1, pinned to its release commit, with verbose diagnostics for the observed JsSecuritySensorV2 timeout. Generated frontend/dist and runtime data are excluded; application sources and JS security analysis remain enabled. The existing 32-minute scan timeout and deploy conditions are unchanged. Sonar completion must be confirmed in Actions; an action upgrade alone does not prove the cloud analyzer stall is fixed.
