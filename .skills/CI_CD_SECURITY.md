# CI/CD and Security Standard

## Environment Strategy

Ogni progetto deve supportare:

- local;
- development;
- staging;
- production.

Usare:

- `.env.example`;
- Infisical.

Mai committare:

- `.env`;
- token;
- password;
- chiavi private.

## Infisical

Configurazione minima repository:

Variables:

- `INFISICAL_PROJECT_ID`
- `INFISICAL_ENV`
- `INFISICAL_IDENTITY_ID` opzionale per OIDC

Secrets:

- `INFISICAL_CLIENT_ID`
- `INFISICAL_CLIENT_SECRET`

Workflow:

- preferire OIDC con Machine Identity;
- fallback supportato: Universal Auth.

Ogni workflow GitHub Actions deve recuperare i secret da Infisical prima degli step che dipendono dalla configurazione applicativa.

## Git Workflow

Branch principali:

- `main`
- `test`

Branch temporanei:

- `feature/*`
- `bugfix/*`
- `hotfix/*`

Regole:

- vietati commit diretti su `main`;
- merge tramite Pull Request;
- CI obbligatoria.

## GitHub Actions Standard

Workflow default:

- `.github/workflows/pipeline.yml`

Trigger:

- push su `main`;
- push su `test`;
- pull request;
- workflow dispatch.

Job/stage attesi:

- ci;
- sonar;
- security;
- deploy.

Usare workflow multipli solo con motivazione documentata.

Usare versioni correnti e supportate di:

- `actions/checkout`;
- `actions/setup-node`;
- `sonarsource/sonarqube-scan-action`;
- `aquasecurity/trivy-action`;
- altre action critiche per security e deploy.

Aggiornare le versioni quando GitHub segnala deprecazioni del runtime delle actions. Per scanner che leggono la git history o commit range, come Gitleaks, usare checkout con `fetch-depth: 0` oppure un depth sufficiente a coprire il range analizzato.

## Required GitHub Secrets

- `DEPLOY_HOST`
- `DEPLOY_USER`
- `DEPLOY_KEY`
- `SONAR_TOKEN`
- `INFISICAL_CLIENT_ID`
- `INFISICAL_CLIENT_SECRET`

## Required GitHub Variables

- `VPS_APP_DIR`
- `PROJECT_URL`
- `HEALTH_URL`
- `SONAR_ORGANIZATION`
- `INFISICAL_PROJECT_ID`
- `INFISICAL_ENV`
- `INFISICAL_IDENTITY_ID` opzionale

Ogni progetto deve documentare in `AGENTS.md` o `docs/DEPLOYMENT.md` le variabili reali usate dalla pipeline e dove si configurano.

## Quality Pipeline

Ordine:

1. Lint
2. Unit Tests
3. Build
4. Coverage
5. Sonar
6. Security Scan
7. Deploy

Se uno step fallisce, deploy bloccato.

## Security Pipeline

Ogni repository deve includere:

- CodeQL;
- Sonar/SonarCloud;
- Trivy filesystem scan;
- Trivy Docker image scan;
- Gitleaks;
- Dependabot;
- `npm audit`;
- `pip-audit` per repository Python.

Bloccare merge/deploy in presenza di vulnerabilita Critical o High salvo eccezione documentata.

Se il repository GitHub non supporta Code Scanning o GitHub Advanced Security, CodeQL puo restare nella pipeline come job informativo non bloccante. In quel caso il gate bloccante resta affidato a Sonar, Trivy, Gitleaks e audit di dipendenze.

## Sonar Policy

- Default: SonarCloud.
- Il job Sonar deve partire a ogni push/PR rilevante.
- Quality Gate visibile su SonarCloud e/o GitHub.
- `sonar.projectKey` deve vivere in `sonar-project.properties`.
- Se la pipeline usa `vars.SONAR_ORGANIZATION`, la variabile deve essere creata in GitHub Actions Variables.
- Se la pipeline usa `secrets.SONAR_ORGANIZATION`, il valore deve essere creato in GitHub Actions Secrets.
- Per repository allineati alla baseline interna, la pipeline esegue la scan ma non usa `sonar.qualitygate.wait=true`, salvo diversa decisione documentata.

## Security Headers

Abilitare dove applicabile:

- CSP;
- HSTS;
- X-Frame-Options;
- X-Content-Type-Options.

## Deploy Rules

- Deploy solo da `main`.
- `test` esegue quality/security ma non deploya.
- Deploy VPS deve usare `VPS_APP_DIR` o variable equivalente documentata.
- Ogni deploy deve eseguire test, security scan, Sonar, build Docker e registrazione progetto se lo standard VPS e applicabile.
- Worktree remoto pulito prima del deploy.
- Dump DB, file runtime e backup non devono restare dentro il repository sul VPS.
- Se l'app usa un database secondario di autenticazione o servizio equivalente, il deploy deve poterlo creare in modo idempotente tramite script committato e documentato.

## Deploy Git Checkout Policy

- Gli script eseguiti dal workflow devono essere committati con permessi corretti.
- Evitare `chmod` sul checkout VPS durante la pipeline se sporca il worktree.
- Il checkout VPS puo impostare `git config core.fileMode false`.
- Se le uniche modifiche locali sul VPS appartengono a una whitelist documentata di file operativi, lo script puo autoripristinarle da `HEAD` prima del checkout.
- Se esistono modifiche locali non whitelisted, deploy deve fallire senza sovrascriverle.

## Documentation Coupling

Quando cambia la procedura reale di build, scan, deploy, secrets o variables aggiornare:

- root `AGENTS.md`;
- `docs/DEPLOYMENT.md`;
- `docs/SECURITY.md`;
- `docs/GITHUB_ACTIONS.md` se presente;
- `docs/SONAR_CONFIGURATION.md` se rilevante;
- `.rag/`.
