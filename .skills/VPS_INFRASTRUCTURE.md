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

## Authelia - Autenticazione Centralizzata

- Authelia e un servizio infrastrutturale condiviso gestito sotto `/opt/infra`, non dai singoli repository applicativi.
- Nginx host rimane il reverse proxy pubblico e puo delegare ad Authelia la verifica di autorizzazione tramite `auth_request` (endpoint compatibile con la versione Authelia installata).
- Il percorso pubblico di login e la configurazione effettiva sono definiti nella documentazione operativa VPS, non in questo standard riusabile.
- Authelia non sostituisce automaticamente l'autenticazione applicativa: per ciascun servizio scegliere e documentare la modalita `authelia-protected`, `app-auth`, `public` o `machine-to-machine`, con motivazione e policy di accesso.
- Non imporre indiscriminatamente il redirect a login su API, webhook, callback OAuth, endpoint health o servizi machine-to-machine; prevedere policy esplicite e limitazioni di accesso appropriate.
- Per risorse protette, negare l'accesso in caso di errore o indisponibilita del servizio di autorizzazione (fail closed); non disabilitare `auth_request` per risolvere errori 5xx.
- Esporre le porte interne dei servizi solo sulle reti necessarie o su loopback; TLS termina su Nginx secondo la configurazione operativa.
- Monitorare healthcheck, restart, consumo RAM, eventi OOM, errori Nginx 401/403/5xx e log Authelia. Dimensionare la memoria da misure reali: nessun limite numerico e universalmente valido.
- Eseguire backup consistenti di configurazione, storage persistente, utenti e segreti Authelia, oltre a Nginx e ai file Compose. Cifrare i backup, conservarli fuori dalla VPS e verificare il restore; mai versionare password, chiavi o database di autenticazione.
- La migrazione su nuova VPS deve ripristinare prima i servizi infrastrutturali condivisi, verificare Authelia/Nginx e solo dopo pubblicare le applicazioni protette.

### Contratto di integrazione per i progetti

Ogni progetto HTTP deve documentare in `AGENTS.md` o `docs/DEPLOYMENT.md`:

- URL pubblico, porta interna, healthcheck e registrazione su Homepage/Uptime Kuma;
- modalita di autenticazione e policy di accesso previste, inclusi eventuali percorsi pubblici, API e webhook;
- proprietario della sessione e dell'identita (Authelia/Nginx oppure applicazione) e requisiti di logout;
- requisiti di metriche/log per l'osservabilita centralizzata (Grafana e servizi collegati).

I progetti non devono creare, modificare o riavviare Authelia, Nginx, Homepage, Grafana o Uptime Kuma durante il proprio deploy, salvo operazione infrastrutturale esplicitamente autorizzata.
