# Piano di standardizzazione delle porte VPS

Data: 2026-11-05. Stato: configurazione Astebook implementata nei sorgenti e autorizzata dall'utente per push su main; deployment da verificare tramite Actions. Le evidenze live VPS restano da acquisire dall'operatore.

## Configurazione Astebook implementata

- Gateway fisso `127.0.0.1:3010:3000`, indipendente da vecchi valori HOST_PORT.
- CI verifica il binding tramite `python3 scripts/check-gateway-port.py`; porte interne, DB e volumi invariati.
- Push su main avvia il deployment esistente con ricostruzione Docker. Aggiornamento Nginx VPS manuale: upstream `http://127.0.0.1:3010`, preservando TLS e login.
- Prima di distribuire AgriAvenger sulla 3000 verificare che Astebook l'abbia liberata.
- Rollback Astebook: revertire il cambio Compose e ridistribuire, ripristinare l'upstream Nginx precedente. Se AgriAvenger occupa 3000, riportarlo prima su 6080. Mai eliminare volumi o ricreare DB.

Il resto del documento conserva l'inventario preliminare e il piano globale: i valori sorgente descritti come attuali si riferiscono alla baseline prima dell'implementazione.

## Evidenze e limiti dell'inventario

Esaminati i Compose e le pipeline dei quattro checkout locali. I mapping sotto sono valori sorgente, non conferme dello stato VPS: override Compose, `.env`, Infisical, unit systemd e container fuori Compose potrebbero modificarli.

| Checkout | HEAD locale esaminato |
| --- | --- |
| Astebook | `841908b6e4a1472894d46159ceedefabacd0be8d` |
| AgriAvenger | `63c13a55389b651ac22947655e6e69042c4904af` |
| Agenzia-Caselli | `b3f28d1324c521bf06c82193d8ab76de59232ac7` |
| Astesmart | `dad259c236b7c388f207e8f50a4461587c1ec138` |

Accesso indicato: `simone@31.220.76.233`. Il tentativo SSH con `BatchMode=yes` è fallito per autenticazione; nessun inventario remoto acquisito. Non risultano verificati repository infrastrutturale, domini pubblici, upstream Nginx, policy Authelia, occupazione porte, firewall, monitor e valori Actions/Infisical. Prima di preparare modifiche eseguibili completare queste verifiche. Non interpretare celle sconosciute come porte libere.

## Registro centralizzato proposto

Il registro definitivo va mantenuto nel repository sorgente di `/opt/infra`, con riferimenti dai progetti; ogni progetto conserva il proprio Compose e la propria pipeline. Questo documento non introduce uno stack infrastrutturale in Astebook.

| Intervallo host | Uso |
| --- | --- |
| 3000–3999 | Gateway progetti |
| 5000–5999 | Servizi generici |
| 6000–6999 | Monitoring e amministrazione |
| 7000–7999 | Autenticazione |
| 8000–8999 | Servizi condivisi |

| Servizio | Mapping sorgente locale attuale | Mapping host proposto | Dipendenze e verifiche |
| --- | --- | --- | --- |
| Astebook | `${HOST_PORT:-3000}:3000` | `127.0.0.1:3010:3000` | Nginx host → app; app → db sulla porta interna configurata; `runtime/`; login `/admin`; libera 3000 per AgriAvenger |
| AgriAvenger | `web`: `6080:80` | `127.0.0.1:3000:80` | Nginx host → web → gateway:3000 → auth:3001/document:3002/metadata:3003/OnlyOffice:80; PostgreSQL e Redis; OAuth, callback documenti, websocket |
| Agenzia Caselli | `${APP_PORT:-3080}:3001` | `127.0.0.1:3020:3001` | Nginx host → app; db con PGPORT configurata; servizio migrate; volumi content/postgres; login admin |
| AsteSmart | `${FRONTEND_PORT:-5000}:80` | `127.0.0.1:3030:80` | Nginx host → proxy → app:3000/backend:8000; scheduler e PostGIS; autenticazione e database auth |
| Uptime Kuma | Sorgente/live da acquisire | `127.0.0.1:6000:<interna verificata>` | Monitor persistenti, websocket, script di registrazione progetti |
| Grafana | Sorgente/live da acquisire | `127.0.0.1:6010:<interna verificata>` | Datasource, login, root URL, eventuali websocket |
| Portainer HTTPS | Sorgente/live da acquisire | `127.0.0.1:6020:<interna HTTPS verificata>` | Nginx con upstream HTTPS e configurazione TLS preservata; endpoint Docker e dati |
| Homepage | Sorgente/live da acquisire | `127.0.0.1:6030:<interna verificata>` | Nginx con auth_request/Authelia; widget, allowed hosts e link ai servizi |
| Authelia | Sorgente/live da acquisire | `127.0.0.1:7000:<interna verificata>` | Nginx auth_request e portale login; sessioni, storage, Redis se presente; protezione Homepage |
| LibreOffice API | Futuro, non da avviare | 8000 riservata | Nessuna modifica ai LibreOffice incorporati nei progetti |

Le porte Docker interne non appartengono a questo registro host: backend AsteSmart:8000 e metadata AgriAvenger:3003 non sono conflitti host. PostgreSQL AgriAvenger pubblica già `127.0.0.1:5432:5432`: preservare e inventariare i consumatori. Gli altri DB nei Compose esaminati non pubblicano porte host. Non cambiare connessioni DB, reti, nomi stack, nomi volumi o mount.

## Inventario remoto richiesto, in sola lettura

Eseguire con credenziali valide e privilegi adeguati; conservare evidenze sanificate fuori dai repository pubblici. Non pubblicare `.env`, dump o l'output integrale di inspect/config che può contenere segreti.

```bash
hostname
id
sudo -n ss -ltnp
docker compose ls --all
docker ps -a --format '{{.Names}}|{{.Ports}}|{{.Status}}'
sudo -n nginx -t
# Esaminare nginx -T in una sessione riservata; registrare solo dati sanificati.
sudo -n nginx -T
sudo -n ufw status verbose
```

Per ogni stack rilevare tramite label Compose: directory di lavoro, project name, elenco ordinato dei file Compose e override, eventuale env-file, commit live, stato Git, immagini e digest, reti e mount effettivi. Eseguire `docker compose config --quiet` con gli stessi argomenti del deployment. Rilevare solo i port binding da inspect, senza esportare l'intero ambiente. Confrontare binding IPv4/IPv6 con `ss` e regole firewall Docker/nftables in sola lettura.

Per `/opt/infra` individuare checkout e remoto Git, Compose sorgente, script `register-project.sh`, configurazioni Homepage/Kuma/Grafana/Authelia, vhost Nginx attivi, include/snippet condivisi e loro proprietario sorgente. Un file presente soltanto sul VPS deve avere una destinazione sorgente e una PR prima della migrazione.

Compilare per ciascun dominio: server_name, certificato, upstream HTTP/HTTPS, porta, location/path rewriting, header forward, websocket, auth_request, redirect/login, URL health e risultato baseline. Cercare riferimenti alle vecchie porte in script, cron/systemd, monitor, widget, callback e automazioni esterne. Per le chiamate tra container usare DNS/porta Docker già esistenti: `127.0.0.1` dentro Kuma/Homepage indica quel container, non l'host VPS.

Verificare su GitHub repository/environment variables e protezioni environment senza leggere valori dei secret. Registrare provenienza e precedenza di HOST_PORT, APP_PORT, FRONTEND_PORT, URL e configurazioni Infisical. Le sole modifiche ai default Compose non bastano se `.env` o un override conservano la vecchia porta.

## Revisione deployment da includere nelle PR

| Repository | Evidenza locale | Correzione/prova da preparare |
| --- | --- | --- |
| Astebook | Deploy su push main; dirty check con whitelist e ripristino file; checkout origin/main; health interno 3000; register-project opzionale; assenza environment production nel job | Bloccare qualsiasi worktree sporco come richiesto dal progetto; release sullo SHA verificato; approvazione environment production prima dei merge operativi; registrazione obbligatoria con prerequisiti validati prima delle mutazioni; health interno invariato più verifica host 3010 e HTTPS |
| Astebook | Infisical recuperato nei job CI/scan, non nel deploy; HOST_PORT proviene dal Compose/.env VPS | Definire e verificare il percorso reale della configurazione runtime; aggiornare HOST_PORT effettivo se mantenuto; non supporre che il runner propaghi automaticamente variabili al VPS |
| AgriAvenger | web pubblicato su 6080 fisso; deploy chiama scripts/deploy-vps.sh; deploy consente security failure/skipped e workflow_dispatch; usa VPS_HOST/VPS_USER/VPS_SSH e secret VPS_APP_DIR/PROJECT_URL/HEALTHCHECK_URL | Esaminare script e renderer env prima delle modifiche; usare binding loopback 3000; bloccare security fallita; deployment solo push main e approvazione production; mantenere nomi variabili funzionanti o migrare esplicitamente |
| Caselli | APP_PORT predefinita 3080; CI smoke e integrazione usano 3080; deploy carica env generata da Infisical, SHA preciso, dirty check rigoroso; environment production già nominato; dispatch su main può deployare | Allineare APP_PORT in exporter/Infisical/Compose; aggiornare verifiche CI che dipendono dal mapping Compose; distinguere porta temporanea docker run CI dalla porta VPS; verificare required reviewers; limitare deploy al push main; esaminare scripts/deploy.sh per migrazioni e registrazione |
| AsteSmart | FRONTEND_PORT predefinita 5000; health backend 8000; deploy rimuove container app, applica whitelist dirty e richiama ensure-auth-db.sh; Vercel su test | Binding loopback 3030 e override coerenti; preservare porte interne; evitare rimozioni manuali non necessarie e operazioni DB per una migrazione porte; verificare script auth DB; approvazione production; lasciare separato Vercel |

Per ogni repo: serializzare deploy, verificare conflitti prima della ricreazione, usare un solo workflow applicativo principale, CI su main/test/PR/dispatch, build/security richiesti, OIDC Infisical ove configurato, `docker compose up -d --build` al deploy e registrazione progetti con URL HTTPS invariati. Non aggiornare versioni di immagini o Actions incidentalmente durante la migrazione delle porte. Astebook contiene anche un workflow di sincronizzazione standard: documentarne separatamente la presenza rispetto alla regola del workflow unico.

Il solo nome `environment: production` non garantisce approvazione: verificare required reviewers e possibilità di bypass. Non eseguire merge su main, workflow dispatch di deploy o modifiche alle protezioni che possano avviare produzione senza approvazione esplicita.

## Sequenza delle PR e gate

1. Completare inventario live e matrice, verificare tutte le porte destinazione, acquisire baseline HTTPS/login/DB e backup configurazioni. Registrare il proprietario del repository infra. Gate: nessuna dipendenza sconosciuta sul servizio da migrare.
2. Preparare PR separate per progetto e infrastruttura: Compose, configurazione runtime, pipeline, test pertinenti, documentazione e rollback. Nel repository infra separare le modifiche Nginx per fase, evitando di applicare tutti gli upstream insieme. Nessun merge anticipato che inneschi deploy.
3. Astebook: 3000 → 3010, Nginx relativo → `http://127.0.0.1:3010`. Gate: health, HTTPS, login admin, runtime e DB invariati; confermare liberazione host 3000.
4. AgriAvenger: 6080 → 3000 su web:80, Nginx → `http://127.0.0.1:3000`. Gate: Astebook validato, 3000 libera immediatamente prima del deploy, login/OAuth, documenti/OnlyOffice e callback verificati.
5. Caselli: 3080 → 3020 su app:3001, Nginx → `http://127.0.0.1:3020`. Gate: login, contenuti e DB operativi, nessuna migrazione schema incidentale.
6. AsteSmart: 5000 → 3030 su proxy:80, Nginx → `http://127.0.0.1:3030`. Gate: frontend, API, autenticazione e scheduler operativi; backend:8000 invariato.
7. Infrastruttura, un servizio alla volta: Kuma 6000, Grafana 6010, Portainer HTTPS 6020, Homepage 6030. Applicare rispettivi upstream e riferimenti operativi; mantenere Authelia sul suo endpoint attuale in questa fase. Validare auth prima del servizio successivo.
8. Authelia → 7000: aggiornare insieme endpoint auth_request, portale e riferimenti effettivi; nessun bypass temporaneo della protezione Homepage. Validare login anonimo/autenticato e sessioni.
9. Verifica globale e secondo deployment controllato delle stesse revisioni: mapping persistenti, monitor stabili e nessun drift. 8000 resta riservata.

Ogni fase produttiva richiede approvazione esplicita riferita a PR/SHA, diff Nginx, configurazione runtime, finestra e rollback. In caso di test fallito fermare la sequenza, ripristinare il singolo servizio e ripetere le verifiche. Non proseguire confidando che il passo successivo risolva il guasto.

## Procedura per singola migrazione dopo approvazione

1. Registrare SHA precedente, immagini/digest, project name, file Compose/override, binding, mount, stato DB/health e configurazione Nginx precedente. Backup protetti esterni al checkout; verificare disponibilità dei backup dati senza ripristinarli né ricreare database.
2. Validare configurazione proposta in CI con valori fittizi e `docker compose config --quiet`; verificare nel modello risultante host IP loopback, porta host prevista e porta interna invariata. Sul VPS verificare worktree pulito, target port libera e configurazione effettiva, senza stampare segreti.
3. Preparare e validare Nginx proposto; applicare la release approvata e il binding persistente nei sorgenti/config runtime. Ricreare soltanto il servizio interessato quando compatibile con la pipeline usando `docker compose up -d --build --no-deps <servizio>`. La pipeline effettiva va verificata prima: non eseguire lo stack intero se attiva migrazioni DB non necessarie.
4. Verificare health interno e nuova porta loopback; applicare il solo diff Nginx previsto, eseguire `nginx -t` e reload, poi verificare HTTPS e autenticazione. Se Nginx non valida, non fare reload e avviare rollback del servizio.
5. Aggiornare monitor/widget/script con destinazioni raggiungibili dal rispettivo contesto; invocare registrazione progetto applicativo mantenendo gli URL pubblici. Controllare log e monitor per almeno tre cicli di healthcheck/monitor configurati.

La ricreazione del gateway può provocare un breve intervallo 502 tra cambio binding e reload. Se la continuità senza interruzioni è necessaria, preparare in PR un binding transitorio aggiuntivo solo loopback sulla nuova porta, validarlo e commutare Nginx prima di rimuovere il vecchio binding. Verificare che pipeline e volumi consentano tale procedura; non avviare una seconda istanza dell'app con worker/cron come scorciatoia.

## Rollback per fase

Ripristinare revisione/immagine precedente, override/variabili runtime e configurazione Nginx salvati, con stessi project name, reti e mount. Ricreare solo il gateway/servizio interessato, validare vecchio endpoint, `nginx -t`, reload e controlli HTTPS/login/DB. Revertire tramite PR anche i sorgenti così il deployment successivo non reintroduce il cambio fallito. Non ripristinare dati DB per un cambio porte.

| Fase | Binding precedente da ripristinare dopo verifica baseline | Dipendenza del rollback |
| --- | --- | --- |
| Astebook | Host 3000 → interno 3000 | Se AgriAvenger occupa già 3000, ripristinare prima AgriAvenger su 6080; mai fermare il servizio sbagliato per liberare la porta |
| AgriAvenger | Host 6080 → web:80 | Verificare 6080 libera, ripristinare upstream e callback/monitor eventualmente aggiornati |
| Caselli | Host effettivo APP_PORT, default 3080 → 3001 | Ripristinare anche Infisical/exporter/env se cambiati |
| AsteSmart | Host effettivo FRONTEND_PORT, default 5000 → 80 | Nessun rollback della porta backend 8000 o dei DB |
| Kuma/Grafana/Portainer/Homepage | Binding rilevati nell'inventario live | Ripristinare singolo servizio, protocollo upstream e riferimenti; dati persistenti invariati |
| Authelia | Binding e endpoint auth rilevati live | Ripristinare insieme tutti i riferimenti auth_request e portale; verificare protezione Homepage senza bypass |

Non eseguire `docker compose down -v`, cancellazioni volumi, prune o ricreazioni DB. Nessun cambio al nome progetto Compose o ai nomi dei volumi. Un rollback globale segue l'ordine inverso delle migrazioni concluse, rispettando la dipendenza della porta 3000.

## Registro di accettazione da compilare

Per ogni riga acquisire timestamp, servizio, SHA, comando/prova, risultato prima/dopo, evidenza sanificata e responsabile. Al momento tutti i controlli live sono **non eseguiti**.

| Controllo | Prova attesa |
| --- | --- |
| Sorgenti e runtime coerenti | Compose risultante, binding inspect e `ss` concordano; nessun override sulla vecchia porta |
| Nessun conflitto | Ogni porta assegnata a un solo servizio; destinazioni verificate prima della modifica |
| HTTPS e domini | Richiesta esterna su ciascun dominio con verifica certificato, redirect e contenuto atteso; niente `curl -k` |
| Health | Check Docker interno, HTTP loopback nuova porta e URL HTTPS pubblico concordanti |
| Login | Utente anonimo non accede a dati protetti; login/logout e sessione reale funzionano per ogni applicazione |
| Homepage/Authelia | Anonimo indirizzato al login; sessione valida accede; logout revoca accesso; auth_request attivo |
| Database e persistenza | Container DB e mount invariati; query di lettura e funzionalità applicative rappresentative passano; runtime e contenuti conservati |
| Esposizione host | Inspect/ss mostrano solo 127.0.0.1 sui gateway; verifica da host esterno su IPv4 e IPv6 che nuove e vecchie porte non consentano accesso diretto |
| Monitoring e integrazioni | Kuma senza errori per più cicli; Homepage/widget/Grafana e registrazione funzionanti; OAuth/webhook/websocket verificati dove presenti |
| Deployment ripetibile | Successiva esecuzione approvata mantiene mapping e non modifica DB/volumi; rollback documentato con baseline disponibile |

## Prerequisiti ancora mancanti

- Autenticazione SSH funzionante (chiave disponibile nell'agent o percorso fornito senza condividere la chiave privata in chat).
- Repository sorgente infrastruttura e proprietario delle configurazioni Nginx.
- Inventario live completo e accesso in lettura a impostazioni Actions/Infisical pertinenti.
- Conferma delle PR/SHA e approvazione esplicita prima di ogni applicazione in produzione.
