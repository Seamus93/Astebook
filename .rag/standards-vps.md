# VPS Infrastructure Standard

Sources:

- `.skills/VPS_INFRASTRUCTURE.md`
- VPS sections in `.skills/AGENTS.md`

## Goal

The VPS standard separates:

- shared server infrastructure;
- application projects;
- persistent data;
- backups;
- operational scripts;
- monitoring;
- operational documentation.

Application repositories may assume this standard exists, but should not manage shared infrastructure directly unless explicitly requested.

## Target OS

- Ubuntu 24.04 LTS.

## Standard Layout

```text
/opt
|- infra/
|  |- docker-compose.yml
|  |- .env
|  |- data/
|  |  |- portainer/
|  |  |- uptime-kuma/
|  |  |- grafana/
|  |  |- homepage/
|  |  `- prometheus/
|  |- backups/
|  |  |- postgres/
|  |  |- docker/
|  |  `- configs/
|  |- logs/
|  |- scripts/
|  |  |- register-project.sh
|  |  |- kuma-create-monitor.py
|  |  |- docker-cleanup.sh
|  |  |- backup-postgres.sh
|  |  `- vps-status.sh
|  `- docs/
|     `- VPS.md
`- projects/
```

## Project Placement

- Shared infrastructure lives under `/opt/infra`.
- Application repositories live under `/opt/projects`.
- Each project lives in `/opt/projects/<project-name>`.
- Application repositories must not install or own shared tools such as:
  - Portainer
  - Homepage
  - Uptime Kuma
  - Grafana
  - Cockpit
  - Prometheus/Loki shared stacks
  - SonarQube

## Reverse Proxy

- Host Nginx is the main public reverse proxy.
- Public traffic should enter Nginx first, then reach project gateway/service.
- Required host endpoint:
  - `http://SERVER_IP/health`

## Infrastructure Tools

Expected shared tools:

- Portainer
- Uptime Kuma
- Grafana
- Homepage
- Cockpit on host

## Uptime Kuma Groups

Standard groups:

- `Livello 1 - Infrastruttura`
- `Livello 2 - Applicazioni`
- `Livello 3 - VPS`
- `Livello 4 - Nginx Reverse Proxy`

Rules:

- project monitors go in `Livello 2 - Applicazioni`;
- VPS monitor goes in `Livello 3 - VPS`;
- host Nginx monitor goes in `Livello 4 - Nginx Reverse Proxy`;
- shared tools go in `Livello 1 - Infrastruttura`.

## Project Registration

Every application deploy must call:

```bash
/opt/infra/scripts/register-project.sh \
  <project-name> \
  <project-url> \
  <health-url>
```

The script must:

- register the project in Homepage;
- create or reuse the Uptime Kuma monitor;
- place it under `Livello 2 - Applicazioni`;
- update `/opt/infra/docs/VPS.md`;
- avoid duplicates.

## Docker Standard

- Each project is a dedicated Docker Compose stack.
- Stack name: `<project-name>`.
- Container naming convention: `<project-name>-<service>`.
- Use multi-stage builds.
- Prefer Alpine images.
- Use distroless where practical.
- Every service should use `restart: unless-stopped`.
- HTTP services must expose `GET /health`.
- HTTP services need a healthcheck:

```yaml
healthcheck:
  test: ["CMD", "curl", "-f", "http://localhost:3000/health"]
  interval: 30s
  timeout: 10s
  retries: 3
```

The healthcheck URL must match the real internal port.

## Docker Labels

Expected labels:

```yaml
labels:
  project.name: "<project-name>"
  project.environment: "production"
  monitoring.enabled: "true"
  homepage.group: "Projects"
  kuma.group: "Livello 2 - Applicazioni"
```

## GitHub Variables Connected to VPS

Reusable variable names:

- `VPS_APP_DIR`
- `PROJECT_URL`
- `HEALTH_URL`

Expected value shapes:

- `VPS_APP_DIR=/opt/projects/<project-name>`
- `PROJECT_URL=<public-project-url>`
- `HEALTH_URL=<public-project-url>/health`

Project-specific expected values belong in root `AGENTS.md` or project deployment docs, not in reusable `.skills` files.

## Final Rule

The application project can assume the VPS standard exists. It should not modify `/opt/infra` structure directly unless the user explicitly asks for infrastructure work.
