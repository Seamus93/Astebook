# Agent Standards Entrypoint

Questo file e l'entrypoint riusabile per gli standard operativi dei progetti.

## Priority Order

In caso di conflitto seguire sempre:

1. Requisiti espliciti del progetto.
2. `AGENTS.md` nella root del progetto.
3. Standard modulari in `.skills/`.
4. ADR in `docs/adr`.
5. Convenzioni del framework.
6. Preferenze dell'agente.

## Standard Modules

- `.skills/PROJECT_STANDARD.md`: missione, principi decisionali, tier, architettura, repo baseline, documentazione, knowledge base.
- `.skills/CI_CD_SECURITY.md`: GitHub Actions, Infisical, Sonar, security scan, deploy gate, Git workflow.
- `.skills/VPS_INFRASTRUCTURE.md`: layout VPS, `/opt/infra`, `/opt/projects`, Nginx, monitoring, registrazione progetti.
- `.skills/DATABASE_API_STANDARD.md`: database, migrazioni, API, CRUD, versioning.
- `.skills/FRONTEND_STANDARD.md`: frontend stack, backoffice, UX e comportamento UI.
- `.skills/MEDIA_STANDARD.md`: media, Cloudinary, asset locali, report migrazione.

## Mandatory Project Knowledge Base

Prima di qualunque implementazione, refactor, debug, deploy o documentazione:

1. Aggiornare o creare `.rag/`.
2. Indicizzare almeno:
   - `AGENTS.md`
   - `.skills/**/*.md`
   - `docs/**/*.md`
   - `docs/adr/**/*.md`
   - `README.md`
   - `Dockerfile`
   - `docker-compose.yml`
   - `package.json`
   - `.github/workflows/**/*.yml`
   - configurazioni progetto come `sonar-project.properties`
3. Recuperare solo il contesto rilevante.
4. Applicare il task usando contesto recuperato e file direttamente coinvolti.
5. Aggiornare documentazione e `.rag/` quando cambiano architettura, deploy, sicurezza, API, schema DB o CI/CD.

## Project-Specific Data Rule

Gli standard in `.skills/` devono restare riusabili.

Non inserire qui:

- nomi progetto concreti;
- URL pubblici;
- porte specifiche;
- path applicativi specifici;
- eccezioni operative di un singolo repository.

Questi valori vanno in:

- `AGENTS.md` root del progetto;
- `docs/`;
- `docs/adr/`;
- `.rag/` del progetto.

## Final Rule

Prima di implementare verificare conformita a:

- standard progetto;
- standard VPS;
- standard security;
- standard CI/CD;
- standard documentazione;
- eventuali ADR e override del progetto.
