# PM Status

## Executive Summary

Astebook is being prepared to move automation responsibilities from Zapier to a repository- and VPS-managed workflow.

## Current Status

- Backend service exists.
- Docker deployment exists.
- Repository baseline compliance is being introduced.
- The current workflow remains stateless.

## Risks

- Zapier replacement requirements are not fully specified yet.
- Email intake and document generation persistence need explicit design before implementation.
- Production secrets must be configured in GitHub Actions and Infisical.

## Next Milestone

Define the self-hosted automation architecture for activation emails and document generation.
