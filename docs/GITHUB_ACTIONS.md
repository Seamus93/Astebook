# GitHub Actions

Astebook uses a single stage-based workflow:

```text
.github/workflows/pipeline.yml
```

## Triggers

- Push to `main`.
- Push to `test`.
- Pull request.
- Manual `workflow_dispatch`.

## Jobs

- `ci`: install, lint, tests, build.
- `sonar`: SonarCloud scan.
- `security`: npm audit, Gitleaks and Trivy scans.
- `codeql`: CodeQL JavaScript analysis, informational.
- `deploy`: VPS deployment, only on push to `main`.

Dependabot pull requests run `ci` only. Sonar, security scans and CodeQL are skipped for `github.actor == 'dependabot[bot]'`.

## Action Versions

- `actions/checkout@v5`
- `actions/setup-node@v6`
- `SonarSource/sonarqube-scan-action@v6`
- `gitleaks/gitleaks-action@v2`
- `aquasecurity/trivy-action@v0.36.0`
- `Infisical/secrets-action@v1.0.15` for OIDC
- `Infisical/secrets-action@v1.0.16` for Universal Auth fallback

## SonarCloud

The SonarCloud job reads:

- `SONAR_TOKEN` from GitHub Secrets.
- `SONAR_ORGANIZATION` from GitHub Variables.

The scan does not wait for `sonar.qualitygate.wait=true`, matching the AgriAvenger baseline described in `.skills/AGENTS.md`.
The Sonar job is time-boxed so a stalled SonarCloud scan cannot keep the pipeline open indefinitely. The scan step has a longer timeout than the historical default because SonarCloud JavaScript security analysis can exceed 18 minutes on the full repository.

## Deploy Variables

- `VPS_APP_DIR`
- `PROJECT_URL`
- `HEALTH_URL`

## Deploy Secrets

- `DEPLOY_HOST`
- `DEPLOY_USER`
- `DEPLOY_KEY`

## Standards Sync Secrets

- `STANDARDS_SYNC_TOKEN`: token with access to push shared `.skills/` and `.rag/standards-*.md` updates to `Seamus93/Template`.

## Infisical

The deploy job fetches Infisical secrets with OIDC when `INFISICAL_IDENTITY_ID` is configured.

## Docker Deploy

Every push to `main` runs:

```bash
docker compose pull
docker compose up -d --build
```

This rebuilds the Astebook container from the current `main` checkout on the VPS.

The deploy action passes `VPS_APP_DIR`, `PROJECT_URL`, `HEALTH_URL` and `REPOSITORY_URL` to the remote SSH session through `envs`.


## Pipeline remediation — 2026-11-09

The compatible dependency lockfile refresh removes the npm audit findings that blocked deployment (no forced major upgrades). CI retains `npm audit --audit-level=high`, Trivy and Gitleaks. Sonar scan action is upgraded from v6 to v8.4.1, pinned to its release commit, with verbose diagnostics for the observed JsSecuritySensorV2 timeout. Generated frontend/dist and runtime data are excluded; application sources and JS security analysis remain enabled. The existing 32-minute scan timeout and deploy conditions are unchanged. Sonar completion must be confirmed in Actions; an action upgrade alone does not prove the cloud analyzer stall is fixed.
