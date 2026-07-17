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
