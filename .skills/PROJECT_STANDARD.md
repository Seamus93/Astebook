# Project Standard

## Mission

Gli agenti AI accelerano analisi, progettazione, sviluppo, testing, deployment, documentazione, manutenzione, osservabilita, automazione e riduzione costi.

## Decision Principles

Favorire:

- soluzione piu semplice;
- soluzione piu mantenibile;
- soluzione piu economica;
- soluzione piu documentata;
- soluzione piu osservabile;
- soluzione piu sicura.

Evitare:

- overengineering;
- tecnologie inutili;
- dipendenze non necessarie;
- complessita prematura.

## Project Tier Classification

Prima di progettare identificare il Tier.

### Tier 1 - MVP

Obiettivo: validazione rapida.

Ottimizzare:

- tempo;
- costo;
- time to market.

Accettabile:

- architettura semplice;
- copertura test minima;
- monitoraggio base.

### Tier 2 - Production

Obiettivo: applicazione stabile per utenti reali.

Richiede:

- test;
- monitoraggio;
- backup;
- sicurezza;
- CI/CD.

### Tier 3 - Enterprise

Obiettivo: alta affidabilita.

Richiede:

- audit;
- compliance;
- disaster recovery;
- observability completa;
- hardening sicurezza;
- scalabilita orizzontale.

## Architecture Standards

- Default: modular monolith.
- Microservizi solo con motivazione documentata e ADR.
- Hosting default: VPS Linux.
- Reverse proxy default: Nginx.
- Source control: Git/GitHub.
- CI/CD: GitHub Actions.

## Standard Technology Stack

- Frontend: React, Vite, TypeScript, Tailwind, Shadcn UI, TanStack Query.
- Backend: Node.js, TypeScript, Fastify.
- Alternative backend: NestJS, Hono.
- Database: PostgreSQL.
- ORM: Prisma, alternativa Drizzle.
- Cache: Redis.
- Queue: BullMQ.
- Auth: Better Auth, alternativa Auth.js/Keycloak.
- AI Provider default: OpenRouter.
- AI supportati: OpenAI, Anthropic, Gemini, DeepSeek.
- Email default: Resend, alternativa Postmark.
- Payments: Stripe.
- Storage: S3 compatible, Cloudflare R2, MinIO, AWS S3.

Ogni deviazione concreta va documentata in `AGENTS.md`, docs o ADR del progetto.

## Repository Baseline

File minimi attesi per progetti con GitHub Actions, Docker Compose e SonarCloud:

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

Se un repository devia dalla baseline, documentare la differenza in docs deploy o ADR.

## Standard Repository Structure

Struttura target generale:

```text
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
```

La struttura reale puo essere piu semplice se giustificata dal tier e documentata.

## Documentation Standard

Ogni repository deve contenere `/docs`.

Documenti minimi:

- `PROJECT_OVERVIEW.md`
- `ARCHITECTURE.md`
- `ROADMAP.md`
- `API.md`
- `DB_SCHEMA.md`
- `PM_STATUS.md`
- `DEPLOYMENT.md`
- `SECURITY.md`

Documentazione visuale attesa:

- ERD;
- User Flow;
- System Flow;
- Deployment Flow.

Usare Mermaid o DBML.

## ADR

Ogni decisione architetturale rilevante deve essere registrata.

Formato:

- `docs/adr/ADR-001-*.md`
- `docs/adr/ADR-002-*.md`

Ogni ADR deve documentare:

- contesto;
- decisione;
- conseguenze.

## Code Documentation Standard

Ogni funzione, metodo pubblico, handler, service function, utility condivisa o script CLI non banale deve avere una specifica leggibile e ricercabile.

Template minimo:

```text
Purpose:
Inputs:
Returns:
Side Effects:
Errors / Constraints:
```

Evitare commenti banali; documentare logica business, integrazioni esterne, sicurezza, migrazioni, deploy e trasformazioni dati.

## PM Deliverables

Per nuovi progetti generare o mantenere:

- Executive Summary;
- Feature List;
- Risk Register;
- Roadmap;
- PM Status;
- GitHub Issues/Milestones quando richiesto.

Devono essere leggibili anche da persone non tecniche.

## Cost Optimization

Preferire:

- VPS;
- open source;
- self hosted.

Valutare SaaS solo se riduce significativamente tempo, rischio o manutenzione.

Documentare:

- costo mensile;
- lock-in;
- alternative.
