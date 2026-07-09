# Astebook Knowledge Index

Updated: 2026-07-09

Indexed sources:
- `AGENTS.md`
- `.skills/AGENTS.md`
- `docs/**/*.md`
- `docs/adr/**/*.md`
- `README.md`
- `Dockerfile`
- `docker-compose.yml`
- `package.json`
- `.github/workflows/**/*.yml`
- `sonar-project.properties`

Relevant context for current task:
- Astebook is a Tier 2 Node/Express automation service for real-estate auction extraction.
- The AI extraction pipeline is implemented primarily in `backend/server.js`.
- Final announcement/proposal merge defaults and address splitting are implemented in `backend/lib/merge_json.js`.
- `/callAI` and Zapier activation flows persist processing logs and final merged output.
- Runtime rule: activation documents are extracted from emails, proposal PDFs/DOCX and OCR fields; unsupported or ignored media should not enter OCR/AI extraction.
