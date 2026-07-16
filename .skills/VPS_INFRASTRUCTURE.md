# VPS Infrastructure Standard

## Obiettivo

La VPS standard deve separare chiaramente:

- infrastruttura condivisa del server;
- progetti applicativi;
- dati persistenti;
- backup;
- script operativi;
- monitoraggio;
- documentazione operativa.

Per un repository applicativo, tale standard e un prerequisito esterno al progetto.

## Target OS

- Ubuntu 24.04 LTS.

## Layout Standard

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

## Regole

- `/opt/infra` contiene solo strumenti infrastrutturali condivisi.
- `/opt/projects` contiene solo repository applicativi deployati.
- ogni progetto deve vivere in `/opt/projects/<project-name>`.
- il repository applicativo non deve installare o gestire direttamente:
  - Portainer
  - Homepage
  - Uptime Kuma
  - Grafana
  - Cockpit
  - SonarQube
  - Prometheus, Loki o stack osservabilita condivisi

## Reverse Proxy Host

- Nginx deve girare sull'host VPS come reverse proxy principale.
- Il traffico pubblico deve entrare prima dal Nginx host e solo dopo raggiungere il gateway o servizio del progetto.
- Endpoint host obbligatorio:
  - `http://SERVER_IP/health`

## Strumenti Infrastrutturali Attesi

- Portainer
- Uptime Kuma
- Grafana
- Homepage
- Cockpit installato sull'host

## Uptime Kuma Standard

Gruppi standard:

- `Livello 1 - Infrastruttura`
- `Livello 2 - Applicazioni`
- `Livello 3 - VPS`
- `Livello 4 - Nginx Reverse Proxy`

Regole:

- i monitor del progetto vanno in `Livello 2 - Applicazioni`;
- il monitor della VPS va in `Livello 3 - VPS`;
- il monitor del Nginx host va in `Livello 4 - Nginx Reverse Proxy`;
- gli strumenti condivisi vanno in `Livello 1 - Infrastruttura`.

## Registrazione Automatica Progetti

Ogni deploy applicativo deve invocare:

```bash
/opt/infra/scripts/register-project.sh \
  <project-name> \
  <project-url> \
  <health-url>
```

Lo script infrastrutturale deve:

- registrare il progetto su Homepage;
- creare o riusare il monitor in Uptime Kuma;
- inserirlo in `Livello 2 - Applicazioni`;
- aggiornare `/opt/infra/docs/VPS.md`;
- evitare duplicati.

## Docker Standards

- Ogni progetto deve essere deployato come stack Docker dedicato.
- Nome stack: `<project-name>`.
- Naming container: `<project-name>-<service>`.
- Usare multi-stage build.
- Preferire immagini Alpine.
- Usare distroless quando possibile.
- Ogni servizio deve avere `restart: unless-stopped`.

Obiettivi indicativi:

- frontend inferiore a 200 MB;
- backend Node inferiore a 500 MB;
- backend Python inferiore a 700 MB.

Ogni servizio HTTP deve esporre `GET /health`.

Risposta minima:

```json
{
  "status": "ok"
}
```

Risposta consigliata:

```json
{
  "status": "ok",
  "database": true,
  "redis": true,
  "version": "1.0.0"
}
```

Ogni servizio HTTP deve avere un healthcheck Docker coerente con la porta interna reale:

```yaml
healthcheck:
  test: ["CMD", "curl", "-f", "http://localhost:3000/health"]
  interval: 30s
  timeout: 10s
  retries: 3
```

## Docker Labels Standard

Ogni container deve avere label equivalenti:

```yaml
labels:
  project.name: "<project-name>"
  project.environment: "production"
  monitoring.enabled: "true"
  homepage.group: "Projects"
  kuma.group: "Livello 2 - Applicazioni"
```

## Variabili GitHub Collegate

Ogni progetto applicativo compatibile con lo standard VPS deve usare o documentare:

- `VPS_APP_DIR`
- `PROJECT_URL`
- `HEALTH_URL`

Valori attesi:

- `VPS_APP_DIR=/opt/projects/<project-name>`
- `PROJECT_URL=<public-project-url>`
- `HEALTH_URL=<public-project-url>/health`

I valori concreti del singolo progetto vanno documentati nel root `AGENTS.md` del progetto o in `docs/DEPLOYMENT.md`, non nello standard riusabile.

## Regola Finale

Il progetto applicativo puo assumere l'esistenza dello standard VPS, ma non deve modificarne direttamente la struttura salvo richiesta esplicita.
