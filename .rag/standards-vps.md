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

## Mandatory Two-Tier Nginx and Docker Port Policy

This policy is mandatory for VPS-hosted HTTP applications; justified exceptions must be recorded in project `AGENTS.md` and `docs/DEPLOYMENT.md`.

- **Host Nginx:** shared VPS-managed public HTTP/HTTPS ingress (80/443), TLS, domains and routing.
- **Project Nginx:** dedicated Nginx container per HTTP project, responsible for frontend/API routing to internal services.
- **Required flow:** `Internet -> host Nginx :443 -> 127.0.0.1:<HOST_PORT> -> project Nginx :80 -> private Docker services`.
- Publish only the project Nginx HTTP entry point by default, using `127.0.0.1:<HOST_PORT>:80` (adapt the internal port if necessary). Do not bind project entry points to `0.0.0.0` or use host networking as the default.
- Container-internal ports may repeat across isolated projects. Published host bindings must be unique per IP, transport protocol and port.
- Do not publish Redis, PostgreSQL, caches or microservice ports to the VPS host for normal operation. Keep them on isolated project Docker networks. Administrative exceptions require documented justification and loopback/tunnel restrictions.
- Record each project's host port, Nginx internal port, domain, health endpoint and exceptions in its own deployment docs. Keep the actual VPS-wide port inventory in `/opt/infra/docs/VPS.md`, never in the reusable Template standard.
- Before deployment, check the effective Docker Compose configuration, VPS inventory, `docker ps` and `ss -tuln` for collisions. Do not automatically reassign another project's port.
- Existing stacks require planned migration and live verification. Synchronizing documentation must not itself change production ports, Nginx or firewall settings.
- See `.skills/VPS_INFRASTRUCTURE.md` for the normative complete standard and sample Compose.

## Planned Host-Port Convention (Documentation Only)

- Future application HTTP ingress host ports should follow increments of ten: `3000`, `3010`, `3020`, `3030`, etc. These are candidate **individual ingress ports**, not reservations of entire ten-port ranges.
- **Astesmart exception:** retain its planned host port `5000` until explicitly changed.
- Do not permanently assign candidates to other projects until actual VPS bindings, port conflicts and dependencies are verified. Astebook currently defaults to host `3000` in its Compose, which is not proof of live allocation.
- Keep app entry points on `127.0.0.1`, behind host Nginx. Internal container ports need not change.
- Maintain separate inventories for applications and shared VPS tools in `/opt/infra/docs/VPS.md`, recording host bind address/port, internal port, proxy/domain, source and verified/planned status.
- Shared tools (e.g. Portainer, Uptime Kuma, Homepage, Grafana, Cockpit, and potentially LibreOffice/Collabora) may use dedicated ports outside the application sequence. Do not assume an installation or actual port without inspecting the VPS.
- **Documentation only:** no Docker Compose, firewall, reverse proxy or production port changes are authorized by this plan. Migrate later with verified inventory and rollback.

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

## Homepage Project Port Description

- Every newly registered Homepage project must use `description: "port X"`, with `X` replaced by the **verified published host port** of the project's HTTP gateway, never the container-internal port or an unverified planned port.
- Keep `href` as the public HTTPS domain, without appending the private host port.
- `/opt/infra/scripts/register-project.sh` (or the equivalent registration mechanism) must obtain the verified host port, write/update the description idempotently, and update it when the host port changes.
- Record actual allocations in the VPS operational inventory and project deployment docs; never embed project-specific assignments in the shared Template.
- Standards synchronization alone must not change production Compose, Nginx, Homepage, or port allocations. See `.skills/VPS_INFRASTRUCTURE.md` for the normative rule.

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

## Centralized Access - Authelia

- Authelia is shared VPS infrastructure under `/opt/infra`; applications do not install or own it.
- Host Nginx can enforce Authelia authorization via `auth_request` before proxying protected apps. Authorization failures must fail closed, not bypass protection.
- Each project documents its auth mode: `authelia-protected`, `app-auth`, `public`, or `machine-to-machine`. Do not force browser login onto APIs, webhooks, OAuth callbacks, or health endpoints without an explicit access design.
- Each project documents public URL, internal port, health endpoint, Homepage/Uptime Kuma registration, access policies, identity/session ownership, and log/metrics expectations for centralized observability (Grafana).
- Monitor Authelia health, restarts, OOM, memory and Nginx auth errors; size resources based on measurements.
- Back up and test restoration of Authelia configuration, persistent data, user database, secrets, Nginx and Compose files; encrypt and keep backups off-host. Never commit credentials.
- Shared infrastructure is provisioned and restored independently of application deployments.
