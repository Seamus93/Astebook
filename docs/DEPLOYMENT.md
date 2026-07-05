# Deployment

Astebook deploys as a dedicated Docker Compose stack on the standard VPS.

## VPS Layout

Expected project path:

```text
/opt/projects/astebook
```

Shared infrastructure remains outside the repository under `/opt/infra`.

## GitHub Variables

- `VPS_APP_DIR=/opt/projects/astebook`
- `PROJECT_URL=<public URL>`
- `HEALTH_URL=<public URL>/health`

## GitHub Secrets

- `DEPLOY_HOST`
- `DEPLOY_USER`
- `DEPLOY_KEY`
- `SONAR_TOKEN`
- `INFISICAL_CLIENT_ID`
- `INFISICAL_CLIENT_SECRET`

## Deploy Flow

1. Push to `main`.
2. CI, SonarCloud and security scans run.
3. The deploy job fetches Infisical secrets with OIDC when configured.
4. GitHub connects to the VPS with `appleboy/ssh-action`.
5. If `/opt/projects/astebook` does not exist, the deploy job clones the repository there.
6. The remote repository must be clean.
7. The deploy job resets the checkout to `origin/main`.
8. Docker Compose pulls base/runtime images, rebuilds and starts stack `astebook`.
9. `/opt/infra/scripts/register-project.sh` registers Homepage and Uptime Kuma.

## Docker

The application service is `astebook-api`.

Every deploy runs:

```bash
docker compose pull
docker compose up -d --build
```

For the current test deployment, the container publishes port `3000` on the VPS host:

```text
${HOST_PORT:-3000}:3000
```

Production access should move back behind the host Nginx reverse proxy with authentication for `/admin`.

While exposed publicly for testing, configure at least:

```text
ADMIN_PASSWORD=<strong password>
ADMIN_SESSION_SECRET=<random secret>
ZAPIER_WEBHOOK_TOKEN=<random webhook token>
```
