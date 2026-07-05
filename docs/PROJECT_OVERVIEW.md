# Project Overview

Astebook is a backend automation service for real-estate auction document workflows.

The current service receives activation data, extracts structured fields from the auction announcement and proposal, enriches selected values, and returns a normalized JSON payload for downstream document generation.

## Tier

Tier 2 - Production.

## Main Capabilities

- `GET /health` for operational health checks.
- `POST /callAI` for announcement/proposal extraction and merge.
- OpenAI-backed field extraction.
- Optional Google Maps geocoding.
- Docker deployment on the standard VPS layout.
