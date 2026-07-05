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

If the SonarCloud project key differs, update `sonar-project.properties` and this document together.
