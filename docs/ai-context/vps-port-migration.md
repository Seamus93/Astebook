# Contesto: standardizzazione porte VPS

Aggiornato: 2026-11-05. Stato: analisi preliminare, nessuna migrazione eseguita.

## Indice delle fonti

- Regole: `AGENTS.md`, `.skills/AGENTS.md`, `.skills/PROJECT_STANDARD.md`, `.skills/CI_CD_SECURITY.md`, `.skills/VPS_INFRASTRUCTURE.md`; catalogo moduli: `.skills/STANDARDS_INDEX.md`.
- Architettura: `docs/adr/ADR-001-compact-node-service.md`, `docs/ARCHITECTURE.md`, `docs/DB_SCHEMA.md`.
- Operazioni: `docs/DEPLOYMENT.md`, `docs/SECURITY.md`, `docs/GITHUB_ACTIONS.md`, `docs/ai-context/ops-deploy.md`, `README.md`.
- Configurazioni: `Dockerfile`, `docker-compose.yml`, `.env.example`, `package.json`, `sonar-project.properties`, `.github/workflows/pipeline.yml`, `.github/workflows/push-standards-to-template.yml`.
- Piano e matrice: `docs/VPS_PORT_MIGRATION.md`.
- Confronto locale: `../AgriAvenger/docker-compose.yml`, `../Agenzia-Caselli/docker-compose.yml`, `../Astesmart/docker-compose.yml` e rispettive `.github/workflows/pipeline.yml`.

## Vincoli e risultati

- L'utente richiede matrice e piano prima dell'implementazione, PR separate e approvazione esplicita prima della produzione.
- Astebook: host attuale predefinito 3000, interno 3000; obiettivo loopback 3010. Non cambiare PostgreSQL, volumi, runtime o login.
- AgriAvenger: gateway pubblico effettivo `web:80`, host 6080; obiettivo loopback 3000, dopo la liberazione di 3000 da Astebook.
- Caselli: app interna 3001, host predefinito 3080; obiettivo loopback 3020.
- AsteSmart: proxy interno 80, host predefinito 5000; obiettivo loopback 3030. Backend interno 8000 invariato.
- I valori sono verificati nei sorgenti locali, non nello stato live né nei repository remoti.
- SSH indicato dall'utente: `simone@31.220.76.233`. Tentativo non interattivo in sola lettura fallito: `Permission denied (publickey,password)`. Nessun comando remoto eseguito.
- Il tunnel suggerito dall'utente sulla porta 3003 non costituisce evidenza di un servizio né sostituisce l'accesso SSH.
- Repository infrastrutturale, configurazioni Nginx effettive, domini attivi e variabili GitHub/Infisical restano da verificare.
- Worktree Astebook già modificato prima del task: preservare tutte le modifiche preesistenti. I soli nuovi file del task sono questo contesto e il piano.
