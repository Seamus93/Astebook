# VPS Infrastructure Standard

## Obiettivo

La VPS standard deve separare chiaramente:

- infrastruttura condivisa del server
- progetti applicativi
- dati persistenti
- backup
- script operativi
- monitoraggio
- documentazione operativa

Per questo repository, tale standard e un prerequisito esterno al progetto applicativo.

## Target OS

- Ubuntu 24.04 LTS

## Layout standard

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
  - stack osservabilita condivisi

## Reverse Proxy host

- Nginx deve girare sull'host VPS come reverse proxy principale.
- il traffico pubblico deve entrare prima dal Nginx host e solo dopo raggiungere il gateway del progetto.
- endpoint host obbligatorio:
  - `http://SERVER_IP/health`

## Strumenti infrastrutturali attesi

- Portainer
- Uptime Kuma
- Grafana
- Homepage
- Cockpit installato sull'host

## Uptime Kuma standard

Gruppi standard:

- `Livello 1 - Infrastruttura`
- `Livello 2 - Applicazioni`
- `Livello 3 - VPS`
- `Livello 4 - Nginx Reverse Proxy`

Regole:

- i monitor del progetto vanno in `Livello 2 - Applicazioni`
- il monitor della VPS va in `Livello 3 - VPS`
- il monitor del Nginx host va in `Livello 4 - Nginx Reverse Proxy`
- gli strumenti condivisi vanno in `Livello 1 - Infrastruttura`

## Registrazione automatica progetti

Ogni deploy applicativo deve invocare:

```bash
/opt/infra/scripts/register-project.sh \
  <project-name> \
  <project-url> \
  <health-url>
```

Lo script infrastrutturale deve:

- registrare il progetto su Homepage
- creare o riusare il monitor in Uptime Kuma
- inserirlo in `Livello 2 - Applicazioni`
- aggiornare `/opt/infra/docs/VPS.md`
- evitare duplicati

## Variabili GitHub collegate

Questo repository usa:

- `VPS_APP_DIR`
- `PROJECT_URL`
- `HEALTH_URL`

Valori attesi per `mcp-server`:

- `VPS_APP_DIR=/opt/projects/mcp-server`
- `PROJECT_URL=https://mcp-server.it`
- `HEALTH_URL=https://mcp-server.it/health`

## Regola finale

Il progetto applicativo puo assumere l'esistenza dello standard VPS, ma non deve modificarne direttamente la struttura salvo richiesta esplicita.
