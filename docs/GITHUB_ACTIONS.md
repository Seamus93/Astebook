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
The Sonar job is time-boxed so a stalled SonarCloud scan cannot keep the pipeline open indefinitely.

## Deploy Variables

- `VPS_APP_DIR`
- `PROJECT_URL`
- `HEALTH_URL`

## Deploy Secrets

- `DEPLOY_HOST`
- `DEPLOY_USER`
- `DEPLOY_KEY`

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
