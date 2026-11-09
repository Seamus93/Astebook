# Sonar Configuration

SonarCloud is configured through:

- `sonar-project.properties`
- `.github/workflows/pipeline.yml`

## Required GitHub Configuration

Secret:

- `SONAR_TOKEN`

Variable:

- `SONAR_ORGANIZATION`

Expected organization:

```text
seamus93
```

## Project Key

```text
Seamus93_Astebook
```

## Source And Test Scopes

`sonar.sources=.` scans the repository, but `backend/tests/**` is excluded from sources and added through `sonar.tests=backend/tests`.
This keeps test files from being indexed twice.

If the SonarCloud project key differs, update `sonar-project.properties` and this document together.


## Pipeline remediation — 2026-11-09

The compatible dependency lockfile refresh removes the npm audit findings that blocked deployment (no forced major upgrades). CI retains `npm audit --audit-level=high`, Trivy and Gitleaks. Sonar scan action is upgraded from v6 to v8.4.1, pinned to its release commit, with verbose diagnostics for the observed JsSecuritySensorV2 timeout. Generated frontend/dist and runtime data are excluded; application sources and JS security analysis remain enabled. The existing 32-minute scan timeout and deploy conditions are unchanged. Sonar completion must be confirmed in Actions; an action upgrade alone does not prove the cloud analyzer stall is fixed.
