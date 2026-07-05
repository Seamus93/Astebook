# PM Status

## Executive Summary

Astebook is being prepared to move automation responsibilities from Zapier to a repository- and VPS-managed workflow.

## Current Status

- Backend service exists.
- Docker deployment exists.
- Repository baseline compliance is being introduced.
- Processing logs and admin bootstrap settings persist under `runtime/`.

## Risks

- Zapier replacement requirements are not fully specified yet.
- Email intake and document generation persistence need explicit design before implementation.
- Runtime tokens configured in the admin UI must be backed by the persistent Docker `runtime/` volume.

## Next Milestone

Define the self-hosted automation architecture for activation emails and document generation.
