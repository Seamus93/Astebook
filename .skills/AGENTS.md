AGENTS.md
Mission
Questo repository utilizza agenti AI per accelerare:
Analisi
Progettazione
Sviluppo
Testing
Deployment
Documentazione
Manutenzione
L'obiettivo è massimizzare:
Velocità di sviluppo
Qualità del codice
Sicurezza
Manutenibilità
Scalabilità
Osservabilità
Automazione
Riduzione dei costi

Priority Order
In caso di conflitto seguire sempre:
Requisiti del progetto
AGENTS.md
ADR (Architectural Decision Records)
Convenzioni del framework
Preferenze dell'agente

Decision Principles
Favorire sempre:
Soluzione più semplice
Soluzione più mantenibile
Soluzione più economica
Soluzione più documentata
Soluzione più osservabile
Soluzione più sicura
Evitare:
Overengineering
Tecnologie inutili
Dipendenze non necessarie
Complessità prematura

Project Tier Classification
Prima di progettare identificare il Tier.
Tier 1 — MVP
Obiettivo:
Validazione rapida
Ottimizzare:
Tempo
Costo
Time To Market
Accettabile:
Architettura semplice
Copertura test minima
Monitoraggio base

Tier 2 — Production
Obiettivo:
Applicazione stabile per utenti reali
Richiede:
Test
Monitoraggio
Backup
Sicurezza
CI/CD

Tier 3 — Enterprise
Obiettivo:
Alta affidabilità
Richiede:
Audit
Compliance
Disaster Recovery
Observability completa
Hardening sicurezza
Scalabilità orizzontale

AI Workflow
Prima di scrivere codice:
Analizzare requisiti
Classificare il Tier
Generare architettura
Generare schema DB
Generare roadmap
Generare issue
Generare documentazione
Solo dopo procedere all'implementazione.

Standard Technology Stack
Source Control
Git
GitHub
CI/CD
GitHub Actions
Hosting
Default:
VPS Linux
Alternative:
Cloud solo se giustificato
Reverse Proxy
Default:
Nginx
Alternative:
Traefik
Caddy

Frontend
Default:
React
Vite
TypeScript
Tailwind
Shadcn UI
TanStack Query
Alternative:
Next.js (SEO o SSR)
React Native

Backend
Default:
Node.js
TypeScript
Fastify
Alternative:
NestJS
Hono

Database
Default:
PostgreSQL

ORM
Default:
Prisma
Alternative:
Drizzle ORM

Cache
Redis

Queue
BullMQ

Authentication
Default:
Better Auth
Alternative:
Auth.js
Keycloak

AI Providers
Default:
OpenRouter
Supportati:
OpenAI
Anthropic
Gemini
DeepSeek

Email
Default:
Resend
Alternative:
Postmark

Payments
Default:
Stripe

Storage
Default:
S3 Compatible
Supportati:
Cloudflare R2
MinIO
AWS S3

Architecture Standards
Default:
Modular Monolith
Utilizzare Microservizi solo se:
esiste una motivazione documentata
è stato creato un ADR

Environment Strategy
Ogni progetto deve supportare:
local
development
staging
production
Utilizzare:
.env.example
Infisical
Mai committare:
.env
token
password
chiavi private
Struttura minima Infisical per progetto:
Project: <project-name>
Environment:
development
staging
production
Valori minimi da predisporre nel repository:
INFISICAL_PROJECT_ID
INFISICAL_ENV
INFISICAL_CLIENT_ID
INFISICAL_CLIENT_SECRET

Git Workflow
Branch principali:
main
test
Branch temporanei:
feature/*
bugfix/*
hotfix/*
Regole:
vietati commit diretti su main
merge tramite Pull Request
CI obbligatoria

## Mandatory Project Knowledge Base

Before starting any implementation, refactor, debugging, deployment or documentation task, the agent MUST build or update the project knowledge base.

The project knowledge base MUST index:

1. `AGENTS.md`
2. `.skills/AGENTS.md`
3. `docs/**/*.md`
4. `docs/adr/**/*.md`
5. `README.md`
6. `Dockerfile`
7. `docker-compose.yml`
8. `package.json`
9. `.github/workflows/**/*.yml`
10. project configuration files such as `sonar-project.properties`

If a `.rag/` or project knowledge index does not exist, the agent MUST create it.

If the index already exists, the agent MUST update it incrementally before working.

The agent MUST retrieve only the context relevant to the current task instead of re-reading the entire repository documentation.

The retrieved knowledge base context MUST be treated as the primary operational context for the task.

## Knowledge Retrieval Workflow

For every task:

1. Identify the task domain.
2. Query the project knowledge base.
3. Retrieve the relevant sections.
4. Apply the task using only the retrieved context plus the directly affected files.
5. Update documentation if the implementation changes architecture, deployment, security, API behavior, database schema, or CI/CD.
6. Re-index changed documentation.

Standard Repository Structure
/apps
/frontend
/backend
/media
/packages
/shared
/ui
/prisma
/docs
/docs/adr
/.skills
/.github
/infrastructure
/scripts
/tests


Repository Baseline Files
Ogni progetto che usa GitHub Actions, Docker Compose e SonarCloud deve mantenere una baseline di file standard allineata ad AgriAvenger.

File minimi attesi:
- `.github/workflows/pipeline.yml`
- `.github/dependabot.yml`
- `docker-compose.yml`
- `sonar-project.properties`
- `.env.example`
- `README.md`
- `docs/DEPLOYMENT.md`
- `docs/SECURITY.md`
- `docs/GITHUB_ACTIONS.md`
- `docs/SONAR_CONFIGURATION.md`

Regola:
- se un repository devia dalla baseline AgriAvenger, la differenza deve essere esplicitata nella documentazione di deploy o in un ADR


Gestione Media
I file media binari non devono restare sciolti nella root del repository.

Regole:
- asset applicativi serviti all'utente finale devono vivere nel flusso previsto dall'app:
  - immagini e video di sito devono essere salvati su Cloudinary, non nel repository e non nel database binario locale, salvo eccezioni documentate
  - `public.site_assets` e il registro applicativo dei media Cloudinary e deve contenere almeno `asset_key`, `asset_type`, `public_id`, `secure_url` e metadata minimi per il rendering
  - il frontend non deve dipendere da file media locali per gli asset di sito: quando richiede un media, il backend deve risolvere il mapping verso Cloudinary e riallinearlo se la riga locale manca
  - struttura Cloudinary standard di progetto:
    - `astesmart/image/site`
    - `astesmart/image/property-types`
    - `astesmart/video/site`
  - eventuali nuove famiglie di media devono restare sotto root `astesmart/<categoria>/<sottocategoria>` con naming esplicito e coerente
  - `public.assets` deve restare solo per eventuali casi legacy o tecnici temporanei, con piano di rimozione o migrazione documentato
  - quando si migrano asset locali verso Cloudinary, usare uno script ripetibile di progetto e produrre un report dei `public_id` generati
- una directory `/media` nel repository e opzionale, non obbligatoria
- se presente, deve contenere solo materiale di lavoro temporaneo non ancora migrato; non e il target finale dei media di sito
- se tutti gli asset applicativi sono gia migrati e verificati su Cloudinary, la directory `/media` puo non esistere
- prima di eliminare un file media locale verificare se e gia stato importato nel provider o nel database usato dal progetto
- i report di migrazione o export operativi non devono sporcare il worktree deployato: salvarli fuori repository o in path runtime dedicati


VPS Infrastructure Compliance
Tutti i progetti devono essere compatibili con la VPS standard.
Struttura:
/opt/infra
/opt/projects

I progetti devono essere installati in:
/opt/projects/<project-name>

È vietato installare dentro il progetto:
Portainer
Homepage
Uptime Kuma
Grafana
Cockpit
SonarQube
Prometheus
Loki

Docker Standards
Naming Convention:
project-service

Esempi:
agriavenger-web
agriavenger-api
agriavenger-postgres

Ogni progetto deve essere deployato come Stack Docker dedicato.
Nome stack:
<project-name>

Utilizzare sempre:
Multi Stage Build
Alpine Images
Distroless quando possibile
Obiettivi:
Frontend < 200 MB
Backend Node < 500 MB
Backend Python < 700 MB

Docker Compose Standards
Ogni servizio deve avere:
restart: unless-stopped

Ogni servizio HTTP deve avere:
healthcheck:
  test: ["CMD", "curl", "-f", "http://localhost:3000/health"]
  interval: 30s
  timeout: 10s
  retries: 3


Docker Labels Standard
Ogni container deve avere:
labels:
  project.name: "<project-name>"
  project.environment: "production"
  monitoring.enabled: "true"
  homepage.group: "Projects"
  kuma.group: "Livello 2 — Applicazioni"


Health Endpoint
Ogni servizio HTTP deve esporre:
GET /health

Risposta minima:
{
  "status": "ok"
}

Risposta consigliata:
{
  "status": "ok",
  "database": true,
  "redis": true,
  "version": "1.0.0"
}


Project Registration
Ogni deploy deve eseguire:
/opt/infra/scripts/register-project.sh \
PROJECT_NAME \
PROJECT_URL \
HEALTH_URL

Lo script deve:
registrare Homepage
registrare Uptime Kuma
aggiornare VPS.md
evitare duplicati

Database Standards
Ogni tabella deve avere:
id UUID
created_at
updated_at

Valutare:
soft delete
audit trail
archiviazione
Ogni relazione deve avere:
foreign key
indice appropriato
constraint

Database Performance
Ogni:
foreign key
filtro
ricerca
ordinamento
deve essere valutato per indicizzazione.
Documentare gli indici.

CRUD Policy
Generare CRUD completi solo per entità business.
Per entità tecniche generare esclusivamente le operazioni necessarie.

Backoffice First
Per ogni Business Entity generare:
CRUD API
CRUD UI
Filtri
Ricerca
Paginazione
Export CSV
salvo diversa indicazione.
L'applicazione deve essere amministrabile da UI.

Migration Rules
Ogni modifica schema richiede:
Migrazione Prisma
Aggiornamento DB_SCHEMA.md
Aggiornamento ERD
Aggiornamento documentazione

API Standards
Default:
REST
Valutare GraphQL solo se necessario.
Ogni endpoint deve avere:
validazione input
validazione output
gestione errori
documentazione
Generare:
OpenAPI
Swagger

API Versioning
Le API pubbliche devono essere versionate.
Formato:
/api/v1/*
/api/v2/*


Code Documentation Standard
Ogni funzione, metodo pubblico, handler, service function, utility condivisa o script CLI non banale deve avere una specifica leggibile e ricercabile.

Regole:
- in Solidity usare NatSpec completa
- in TypeScript, JavaScript e Python usare Dev Spec equivalente tramite docstring o commento strutturato sopra la funzione
- la specifica minima deve spiegare:
  - scopo
  - input principali
  - output o side effects
  - errori o precondizioni importanti
- evitare commenti banali; documentare soprattutto logica business, integrazioni esterne, sicurezza, migrazioni, deploy e trasformazioni dati
- quando una funzione cambia in modo sostanziale, aggiornare anche la sua specifica

Template minimo Dev Spec:
Purpose:
Inputs:
Returns:
Side Effects:
Errors / Constraints:


Quality Standards
TypeScript:
Strict Mode obbligatorio
Vietato any salvo motivazione documentata
Linting:
Biome
Formatting:
Biome
Unit Test:
Vitest
Coverage minimo:
80%

E2E:
Playwright

Pull Requests
Ogni PR deve includere:
descrizione
test eseguiti
impatto architetturale
eventuali ADR

SonarQube / SonarCloud
Default:
SonarCloud
Alternative:
SonarQube Self Hosted
Analisi obbligatorie:
Bugs
Vulnerabilities
Security Hotspots
Code Smells
Duplications
Coverage
Maintainability
Per questo repository:
- la scan Sonar e obbligatoria
- la Quality Gate deve restare visibile su SonarCloud e GitHub
- la pipeline non attende la Quality Gate nel job Sonar, allineata ad AgriAvenger
- eventuale ritorno a gate bloccante richiede aggiornamento di AGENTS.md, `docs/GITHUB_ACTIONS.md` e `docs/SONAR_CONFIGURATION.md`


Security Standards
Secret Management
Utilizzare:
Infisical
Mai committare:
.env
password
token
chiavi private
Per GitHub Actions preferire l'integrazione nativa Infisical.
Autenticazione supportata:
OIDC con Machine Identity
Universal Auth con Machine Identity
Configurazione repository minima:
Repository Variables:
INFISICAL_PROJECT_ID
INFISICAL_ENV
INFISICAL_IDENTITY_ID opzionale se si usa OIDC
Repository Secrets:
INFISICAL_CLIENT_ID
INFISICAL_CLIENT_SECRET

Security Headers
Abilitare:
CSP
HSTS
X-Frame-Options
X-Content-Type-Options

Security Pipeline
Ogni repository deve includere:
CodeQL
Sonar
Trivy
Gitleaks
Dependabot
npm audit
pip-audit per repository Python
Bloccare merge e deploy in presenza di:
Critical
High
Le GitHub Actions di security devono usare release correnti e supportate.
Quando una action viene aggiornata o sostituita, aggiornare anche AGENTS.md e la documentazione CI/CD del repository.
Se il repository GitHub non supporta Code Scanning / GitHub Advanced Security, CodeQL puo restare nella pipeline come job informativo non bloccante.
In quel caso il gate bloccante resta affidato a Sonar, Trivy, Gitleaks e npm audit.

CI/CD Standards
Generare sempre:
.github/workflows/

Default obbligatorio:
pipeline.yml

La pipeline GitHub Actions deve essere preferibilmente unica, stile stage-based, con job separati interni:
ci
sonar
security
deploy

Utilizzare workflow multipli separati solo se esiste una motivazione documentata.

Trigger standard:
push su:
main
test
pull_request
workflow_dispatch

Regole deploy:
deploy solo da main
test esegue quality/security ma non deploya

Infisical Workflow Policy:
Ogni workflow GitHub Actions deve recuperare i secret da Infisical prima degli step che dipendono dalla configurazione applicativa.
Default consigliato:
OIDC con `Infisical/secrets-action`
Fallback supportato:
Universal Auth con `INFISICAL_CLIENT_ID` e `INFISICAL_CLIENT_SECRET`

Sonar Policy:
Default SonarCloud
Il job Sonar deve partire in GitHub Actions a ogni push/PR rilevante
Il Quality Gate deve essere visibile come status check GitHub o almeno come analisi SonarCloud raggiungibile dal run
Configurazione minima GitHub Actions:
SONAR_TOKEN in Repository Secrets
SONAR_ORGANIZATION come Repository Variable oppure Repository Secret, ma la pipeline deve essere coerente con la scelta
Se la pipeline usa vars.SONAR_ORGANIZATION, la variabile deve essere creata in Settings > Secrets and variables > Actions > Variables
Se la pipeline usa secrets.SONAR_ORGANIZATION, il valore deve essere creato in Repository Secrets
Per repository allineati ad AgriAvenger:
- `sonar.projectKey` vive in `sonar-project.properties`
- la pipeline esegue la scan ma non usa `sonar.qualitygate.wait=true`


GitHub Actions / Deploy Inventory
Ogni progetto deve documentare in AGENTS.md le variabili reali usate dalla pipeline e dove si configurano.

Percorso GitHub:
- Repository -> Settings -> Secrets and variables -> Actions
- tab `Secrets` per valori sensibili
- tab `Variables` per configurazione non sensibile

Repository corrente `astesmart`:

Secrets GitHub obbligatorie:
- `DEPLOY_HOST`
  - uso: host VPS usato dal job deploy via `appleboy/ssh-action`
  - dove si trova: IP o hostname del VPS di progetto
- `DEPLOY_USER`
  - uso: utente SSH remoto del deploy
  - dove si trova: utente applicativo creato sul VPS, tipicamente `deploy`
- `DEPLOY_KEY`
  - uso: chiave privata SSH usata da GitHub Actions
  - come si crea: generare una keypair, aggiungere la public key in `~/.ssh/authorized_keys` dell'utente deploy sul VPS, salvare la private key in GitHub Secrets
- `SONAR_TOKEN`
  - uso: autenticazione SonarCloud per il job `sonar`
  - dove si trova: SonarCloud -> My Account -> Security / Access Tokens
  - come si crea: creare o rigenerare un token dall'account che ha accesso al progetto privato
- `INFISICAL_CLIENT_ID`
  - uso: fallback Universal Auth per il recupero dei secret runtime
  - dove si trova: Infisical -> Machine Identities / Universal Auth
- `INFISICAL_CLIENT_SECRET`
  - uso: fallback Universal Auth per il recupero dei secret runtime
  - dove si trova: Infisical -> Machine Identities / Universal Auth

Variables GitHub obbligatorie:
- `VPS_APP_DIR`
  - uso: path progetto remoto usato dallo step deploy
  - valore atteso corrente: `/opt/projects/astesmart`
  - dove si trova: path reale del repository applicativo sul VPS
- `PROJECT_URL`
  - uso: registrazione del progetto tramite `/opt/infra/scripts/register-project.sh`
  - dove si trova: URL pubblico principale del progetto
- `HEALTH_URL`
  - uso: registrazione del health check infrastrutturale
  - dove si trova: URL pubblico dell'endpoint `/health`
- `SONAR_ORGANIZATION`
  - uso: organization key SonarCloud
  - dove si trova: SonarCloud -> Organization settings
  - valore atteso corrente: `seamus93`
- `INFISICAL_PROJECT_ID`
  - uso: project slug Infisical letto dai workflow
  - dove si trova: Infisical -> Project settings
- `INFISICAL_IDENTITY_ID`
  - uso: Machine Identity OIDC opzionale
  - dove si trova: Infisical -> Machine Identities
- `INFISICAL_ENV`
  - uso: environment slug letto dai workflow
  - dove si trova: Infisical -> Environments

Regole operative:
- non introdurre nuovi nomi di secret o variable se esiste gia uno standard AgriAvenger applicabile
- se il workflow usa `VPS_APP_DIR`, documentare `VPS_APP_DIR`; se usa `DEPLOY_PATH`, documentare `DEPLOY_PATH`
- AGENTS.md, `docs/DEPLOYMENT.md`, `docs/GITHUB_ACTIONS.md` e `docs/SECURITY.md` devono restare coerenti con i nomi reali del workflow
- ogni valore hardcoded di progetto nel workflow deve essere spiegato in documentazione oppure spostato in variable GitHub

GitHub Actions Maintenance Policy:
Usare versioni correnti e supportate di:
actions/checkout
actions/setup-node
sonarsource/sonarqube-scan-action
aquasecurity/trivy-action
Aggiornare le versioni quando GitHub segnala deprecazioni del runtime delle actions.
Per scanner che leggono la git history o commit range, come Gitleaks, usare checkout con fetch-depth: 0 oppure un depth sufficiente a coprire il range analizzato.

Workflow Creation / Update Rule:
Ogni volta che cambia la procedura reale di:
build
security scan
quality gate
deploy
secrets/variables GitHub
secrets/variables Infisical
l'agente deve aggiornare anche:
AGENTS.md
docs/DEPLOYMENT.md
docs/SECURITY.md
se necessario docs/AGENTS_COMPLIANCE.md

Deploy Git Checkout Policy:
I file di script eseguiti dal workflow deploy devono essere committati con i permessi corretti nel repository.
Evitare `chmod` sul checkout del VPS durante la pipeline, perche puo sporcare il worktree remoto e bloccare `git checkout` o `git pull`.
Sul VPS il checkout deploy puo impostare `git config core.fileMode false` per evitare drift locali dovuti solo al bit eseguibile.
Se le uniche modifiche locali sul VPS appartengono alla whitelist di file di deploy/documentazione operativa, lo script puo autoripristinarle da `HEAD` prima del `checkout`.
Se esistono altre modifiche locali, il deploy deve fallire senza sovrascriverle.


Quality Pipeline
Lint
↓
Unit Tests
↓
Build
↓
Coverage
↓
Sonar
↓
Security Scan
↓
Deploy

Se uno step fallisce:
DEPLOY BLOCCATO


Deployment Standards
Ogni workflow deploy deve:
eseguire test
eseguire security scan
eseguire Sonar
build Docker
deploy VPS
eseguire register-project.sh

Per repository stile AgriAvenger / AsteSmart:
- usare una pipeline unica `pipeline.yml`
- usare versioni correnti di `actions/checkout`, `actions/setup-node`, `SonarSource/sonarqube-scan-action`, `aquasecurity/trivy-action`
- usare `appleboy/ssh-action` per deploy SSH
- il path progetto remoto deve arrivare da `VPS_APP_DIR` oppure da una variable equivalente esplicitamente documentata
- il deploy deve poter creare in modo idempotente il database secondario auth se l'app usa `PGDATABASE_AUTH`, ad esempio tramite `scripts/ensure-auth-db.sh`
- il compose applicativo non deve esporre PostgreSQL sull'host salvo motivazione documentata
- il worktree remoto deve essere pulito prima del deploy; dump DB, file runtime e backup non devono restare dentro il repository sul VPS

Observability Standards
Ogni progetto deve integrare:
Error Tracking
Sentry
Monitoring
Uptime Kuma
Metrics
Prometheus
Grafana
Logs
Loki

Monitoring Standards
Monitor minimi:
Frontend
Backend
Gateway
Database
Redis
quando presenti.

Backup Standards
Ogni progetto deve definire:
backup database
retention policy
recovery procedure
Backup automatici obbligatori.

Documentation Standards
Ogni repository deve contenere:
/docs

Documenti minimi:
PROJECT_OVERVIEW.md
ARCHITECTURE.md
ROADMAP.md
API.md
DB_SCHEMA.md
PM_STATUS.md
DEPLOYMENT.md
SECURITY.md


Visual Documentation
Generare sempre:
ERD
User Flow
System Flow
Deployment Flow
Utilizzare:
Mermaid
DBML

ADR
Ogni decisione architetturale deve essere registrata.
Formato:
ADR-001.md
ADR-002.md

Documentare:
contesto
decisione
conseguenze

GitHub Projects
Generare automaticamente:
Epic
Milestone
Issue
Kanban
Roadmap

PM Deliverables
Generare sempre:
Executive Summary
PM Status
Feature List
Risk Register
Roadmap
Devono essere leggibili anche da persone non tecniche.

Cost Optimization
Preferire:
VPS
Open Source
Self Hosted
Valutare SaaS solo se:
riduce significativamente il tempo
riduce il rischio
migliora la manutenzione
Documentare:
costo mensile
lock-in
alternative

Skills Registry
Le skill sono definite in:
/.skills

L'agente deve selezionare automaticamente le skill necessarie.
Skill raccomandate:
architecture
backend
frontend
database
security
devops
testing
documentation
product-manager
observability
performance
cost-optimization
ui-ux
api-design
automation
saas
crm
erp
marketplace
ai-agent


Mandatory Outputs
Per ogni nuovo progetto generare:
Executive Summary
Architettura
Repository Structure
Schema Prisma
ERD
API Contract
Roadmap
GitHub Issues
PM Status
Docker Setup
Security Plan
Backup Plan
Test Plan
Deployment Plan
Monitoring Plan
GitHub Actions
Sonar Configuration
Security Workflow
Verificare che tutti gli output siano presenti prima dell'implementazione.

Final Rule
Prima di implementare qualsiasi progetto verificare:
conformità AGENTS.md
conformità VPS Standard
conformità Security Standards
conformità CI/CD Standards
conformità Monitoring Standards
Se una sezione obbligatoria manca, l'implementazione non può iniziare.





