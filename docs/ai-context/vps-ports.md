# VPS port migration context

Updated: 2026-11-05.
Sources: AGENTS.md (where present), .skills/AGENTS.md, .skills/CI_CD_SECURITY.md, .skills/VPS_INFRASTRUCTURE.md, docs/DEPLOYMENT.md, docker-compose.yml, Dockerfile, package.json, .github/workflows/pipeline.yml.

Gateway: app; binding: 127.0.0.1:3010:3000. Fixed host mapping deliberately ignores obsolete host-port environment settings. Internal ports, database connections, networks, volumes and authentication remain unchanged. VPS Nginx changes are manual. See docs/VPS_PORT_MIGRATION.md for sequencing and rollback.
