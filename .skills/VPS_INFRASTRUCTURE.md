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

## Standard Obbligatorio: Due Livelli Nginx e Porte Docker

Questo standard e **obbligatorio** per ogni applicazione HTTP deployata sulla VPS. Eventuali eccezioni tecniche devono essere motivate e documentate in `AGENTS.md` e `docs/DEPLOYMENT.md` del singolo repository, prima del deploy.

### Separazione delle responsabilita

1. **Nginx host (infrastruttura):** unico ingresso HTTP/HTTPS pubblico standard sulle porte 80/443; gestisce TLS, virtual host, dominio e instradamento al progetto. E gestito in ambito VPS, non dal repository applicativo.
2. **Nginx progetto (applicazione):** ogni progetto HTTP deve includere il proprio Nginx nel suo stack Docker, responsabile di frontend, routing API e proxy verso i servizi interni. Il progetto mantiene autonomamente questa configurazione.
3. **Servizi interni:** gateway, backend, microservizi, Redis e database comunicano su reti Docker; non richiedono porte pubblicate sull'host.

Flusso richiesto: `Internet -> Nginx host :443 -> 127.0.0.1:<HOST_PORT> -> Nginx progetto :80 -> servizi Docker interni`.

### Pubblicazione delle porte

- Per ciascun progetto HTTP, pubblicare **una sola porta HTTP di ingresso** del Nginx applicativo sull'host, salvo eccezioni documentate.
- Pubblicarla esclusivamente su loopback: `127.0.0.1:<HOST_PORT>:80` (oppure la porta interna effettiva del Nginx progetto).
- Non usare `<HOST_PORT>:80`, `0.0.0.0:<HOST_PORT>:80` o `network_mode: host` per l'ingresso applicativo standard.
- Le porte interne dei container **possono ripetersi** tra progetti distinti: ad esempio ogni progetto puo usare `3000` per il backend e `6379` per Redis.
- Le porte pubblicate sull'host devono essere **univoche per coppia IP/protocollo/porta**. Non presumere che una porta sia libera solo perche non compare nel repository.
- Non pubblicare Redis, PostgreSQL o altri database/cache sull'host per il normale funzionamento. Accessi amministrativi eccezionali devono essere limitati a loopback o tunnel sicuri, motivati e documentati.
- Isolare i progetti con reti Docker dedicate. Non collegare servizi sensibili a reti condivise se non strettamente necessario.

Esempio conforme nel `docker-compose.yml` applicativo:

```yaml
services:
  nginx:
    image: nginx:alpine
    ports:
      - "127.0.0.1:${HOST_PORT:-6080}:80"
    depends_on:
      - api
    networks:
      - app
  api:
    build: ./api
    expose:
      - "3000"
    networks:
      - app
  redis:
    image: redis:7-alpine
    networks:
      - app
networks:
  app:
    driver: bridge
```

La porta `6080` nell'esempio e illustrativa, **non e una prenotazione globale**. Il Nginx host deve inoltrare al `127.0.0.1:<HOST_PORT>` del progetto. `expose` non pubblica una porta sull'host ed e facoltativo per la comunicazione fra container della stessa rete.

### Inventario, controlli e migrazione

- Ogni progetto deve documentare `HOST_PORT`, porta interna del Nginx applicativo, nome del servizio, dominio, endpoint health e tutte le eventuali eccezioni in `docs/DEPLOYMENT.md` o `AGENTS.md`.
- L'inventario operativo delle porte effettivamente assegnate e dei reverse proxy deve essere mantenuto in `/opt/infra/docs/VPS.md`; i valori specifici dei progetti **non** devono essere copiati negli standard condivisi di `Template`.
- Prima di ogni nuova assegnazione o modifica di una porta host, verificare l'inventario e lo stato reale con `docker ps --format "table {{.Names}}\\t{{.Ports}}"` e `ss -tuln`. Considerare anche servizi host non Docker.
- La pipeline di deploy deve verificare che la configurazione Compose risultante sia valida e che le nuove porte host non siano in conflitto; non deve interrompere o riassegnare automaticamente porte di altri progetti.
- Le applicazioni esistenti non conformi vanno migrate in modo pianificato, verificando prima i binding reali e il proxy host. **Non** cambiare automaticamente mapping, firewall o Nginx di produzione durante la sincronizzazione degli standard.
- Se il Nginx di progetto e il Nginx host risiedono su macchine differenti o si adotta un'infrastruttura di rete diversa, serve una deroga esplicita con controlli equivalenti di isolamento e sicurezza.

### Piano futuro di razionalizzazione delle porte host (solo documentazione)

**Stato: pianificato, non applicato.** Per i progetti applicativi HTTP, adottare progressivamente porte di ingresso host a passi di dieci: `3000`, `3010`, `3020`, `3030`, ecc. Ogni numero e un **candidato per una singola porta di ingresso**, non la prenotazione automatica dell'intero intervallo di dieci porte. Non modificare le porte interne dei container per aderire alla convenzione.

- **Eccezione esplicita:** Astesmart mantiene la porta host `5000` come scelta prevista; non deve essere migrato alla serie `3000 + 10n` senza una decisione successiva.
- Per gli altri progetti, assegnare i candidati `3000 + 10n` **solo dopo** aver verificato occupazione reale, inventario VPS e dipendenze. Non associare ora in modo definitivo un numero a un progetto; un candidato puo essere gia occupato (ad esempio `3000` e il default Compose di Astebook).
- Mantenere i binding applicativi su `127.0.0.1` secondo la policy precedente; l'Nginx host continua a ricevere il traffico pubblico su `80/443`.
- **Separare l'inventario delle applicazioni dall'inventario degli strumenti infrastrutturali** in `/opt/infra/docs/VPS.md`. Per ogni servizio annotare nome, categoria, porta host effettiva, indirizzo di binding, porta interna, dominio/proxy, fonte e stato (verificato/pianificato).
- Gli strumenti condivisi (es. Portainer, Uptime Kuma, Homepage, Grafana, Cockpit, SonarQube e possibili servizi documentali come LibreOffice/Collabora) possono usare porte dedicate **fuori dalla convenzione applicativa**, ma nessuna porta o installazione va presunta senza verifica sul VPS. LibreOffice/Collabora e solo un possibile servizio da censire, non una componente confermata.
- Le porte host pubblicate dagli strumenti condivisi restano soggette a verifica dei conflitti e a regole di esposizione minima; ove possibile sono raggiunte tramite il Nginx host e binding loopback.
- Questa sezione **non autorizza modifiche automatiche** a Docker Compose, `.env`, Nginx host, firewall o servizi in produzione. La migrazione avverra in una fase separata, con inventario verificato, assegnazioni approvate e piano di rollback.

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

### Standard Homepage: descrizione della porta host

- Ogni nuovo progetto registrato su Homepage deve avere la proprieta `description` nel formato esatto `port X`, dove `X` e la porta host effettivamente assegnata all'ingresso HTTP del progetto (variabile `HOST_PORT` o mapping Compose equivalente).
- Non usare la porta interna del container e non mostrare una porta candidata o pianificata come se fosse gia attiva. Se il valore non e verificato, interrompere la registrazione automatica o richiedere conferma: non inventarlo.
- La proprieta `href` deve continuare a puntare al dominio HTTPS pubblico, senza aggiungere la porta host privata all'URL.
- Lo script `/opt/infra/scripts/register-project.sh` o l'integrazione equivalente deve ricavare o ricevere la porta host verificata, creare/aggiornare la descrizione anche per progetti gia registrati e non creare duplicati.
- Quando cambia la porta host di un progetto, aggiornare contestualmente la voce Homepage, l'inventario VPS, il mapping Compose e il reverse proxy host, con validazione e rollback. La sincronizzazione degli standard non deve modificare direttamente la produzione.
- Le assegnazioni concrete rimangono nella documentazione operativa VPS e nei repository applicativi, non nel Template condiviso.

Esempio illustrativo (porta non prenotata):

```yaml
- Progetti:
    - NomeProgetto:
        href: https://progetto.example.com
        description: "port 30XX"
```

Nel deployment reale, sostituire `30XX` con il numero effettivo, ad esempio `3040`, solo dopo la verifica della porta.

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
