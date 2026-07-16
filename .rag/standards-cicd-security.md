# CI/CD and Security Standard

Sources:

- `.skills/AGENTS.md`
- `.skills/CI_CD_SECURITY.md`

## Secret Management

- Use Infisical.
- Never commit `.env`, tokens, passwords or private keys.
- Minimum Infisical repository variables:
  - `INFISICAL_PROJECT_ID`
  - `INFISICAL_ENV`
  - `INFISICAL_IDENTITY_ID` optional for OIDC
- Minimum Infisical repository secrets:
  - `INFISICAL_CLIENT_ID`
  - `INFISICAL_CLIENT_SECRET`
- Workflows should retrieve Infisical secrets before steps that depend on application configuration.

## GitHub Workflow

Branches:

- `main`
- `test`
- temporary branches: `feature/*`, `bugfix/*`, `hotfix/*`

Rules:

- no direct commits to `main`;
- merge via pull request;
- CI required.

## Required GitHub Actions Pattern

- Prefer a single workflow: `.github/workflows/pipeline.yml`.
- Trigger on:
  - push to `main`
  - push to `test`
  - pull request
  - workflow dispatch
- Jobs/stages:
  - CI
  - Sonar
  - Security
  - Deploy
- Deploy only from `main`.
- Use current supported versions of critical actions such as checkout, setup-node, Sonar and Trivy.
- Use `fetch-depth: 0` or sufficient history for scanners that inspect commit ranges.

## Quality Pipeline

Order:

1. Lint
2. Unit tests
3. Build
4. Coverage
5. Sonar
6. Security scan
7. Deploy

If one step fails, deploy is blocked.

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

Projects should document the real variables and secrets used by their workflow in root `AGENTS.md` or deployment docs.

## Security Pipeline

Expected tools:

- CodeQL
- SonarCloud
- Trivy filesystem scan
- Trivy Docker image scan
- Gitleaks
- Dependabot
- `npm audit`
- `pip-audit` for Python projects

Critical and high findings block merge/deploy unless project docs explicitly define a justified exception.

If Code Scanning or GitHub Advanced Security is unavailable, CodeQL may remain informational. The blocking gate should still rely on Sonar, Trivy, Gitleaks and dependency audits.

## Sonar Policy

- Default: SonarCloud.
- Analysis required on each relevant push/PR.
- Quality Gate should be visible on SonarCloud and/or GitHub.
- `sonar.projectKey` lives in `sonar-project.properties`.
- The pipeline must be coherent about whether `SONAR_ORGANIZATION` is configured as a GitHub variable or secret.
- Internal baseline pipelines run the scan but do not set `sonar.qualitygate.wait=true`, unless a documented decision changes that.

## Deploy Worktree Policy

- Remote deploy worktree must be clean before deploy.
- Runtime dumps, backups and generated reports must not stay inside the remote repository checkout.
- Do not run `chmod` during deploy if it dirties the VPS checkout.
- Prefer committing correct file permissions.
- VPS checkout may set `git config core.fileMode false` to avoid executable-bit drift.
- Deploy may only auto-restore explicitly whitelisted local drift.
- Otherwise, fail rather than overwrite remote changes.
- Optional secondary service databases must be created idempotently by committed, documented scripts when required by the app.

## Documentation Coupling

When real build, scan, deploy, GitHub variables/secrets or Infisical behavior changes, update:

- root `AGENTS.md`
- `docs/DEPLOYMENT.md`
- `docs/SECURITY.md`
- `docs/GITHUB_ACTIONS.md` when present
- `docs/SONAR_CONFIGURATION.md` when relevant
- project RAG index
