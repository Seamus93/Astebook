# Frontend Admin Knowledge

Updated: 2026-09-22

Purpose: fast retrieval map for the protected React admin UI, settings page, event detail workflow and related styles.

## Entry Points

- `frontend/src/main.jsx`: React entry point.
- `frontend/src/App.jsx`: admin dashboard shell served under `/admin`.
- `frontend/src/ConsoleAdmin.jsx`: dedicated `/admin/settings` page.
- `frontend/src/adminClient.js`: dashboard initializer and controller wiring.
- `backend/routes/admin_auth.js`: server-rendered login/setup/recovery before the protected SPA.

## Admin Modules

- `frontend/src/admin/apiClient.js`: authenticated fetch and token retry.
- `frontend/src/admin/eventList.js`: processing event list and mailbox sidebar loading.
- `frontend/src/admin/detailController.js`: selected event detail panes and actions.
- `frontend/src/admin/settingsController.js`: settings load/save, saved-values panel and recipients.
- `frontend/src/admin/learningController.js`: auto-learning feedback summary panel.
- `frontend/src/admin/workflowView.js`: workflow step status rendering.
- `frontend/src/admin/structuredView.js`: nested data display.
- `frontend/src/admin/fileSections.js`: file/step grouping.
- `frontend/src/admin/toast.js`: notifications.
- `frontend/src/admin/shell.js`: sidebar behavior.

## Styles

- `frontend/src/styles.css`: CSS entrypoint.
- `frontend/src/styles/base.css` and `frontend/src/styles/base/*.css`: tokens, reset, shell, header, buttons.
- `frontend/src/styles/events.css`: event list and detail heading basics.
- `frontend/src/styles/workflow.css`: workflow and substepper.
- `frontend/src/styles/panels.css` and `frontend/src/styles/panels/*.css`: panes, data view, sections and steps.
- `frontend/src/styles/settings.css` and `frontend/src/styles/settings/*.css`: settings page, forms, summary, feedback and recipients.
- `frontend/src/styles/overlays.css`: modal, notification and toast styles.
- `frontend/src/styles/responsive.css`: responsive layout rules.

## Important Signals

- Endpoint catalog: `docs/API.md`.
- Canonical admin UI behavior: `docs/FRONTEND_ADMIN.md`.
- UI handoff workflow: `docs/UI_DESIGN_HANDOFF.md`.
- Frontend standard: `.skills/FRONTEND_STANDARD.md`.
- Settings are a protected page at `/admin/settings`, not a modal.
- Login/setup stay server-rendered unless the server-side protection model changes.
- Vite output is `frontend/dist` and is served by Express under `/admin`.

## Verification

- Build: `npm run build`
- Lint: `npm run lint`
- Backend tests: `npm test`

## Retrieval Queries

- Admin controllers: `rg -n "create.*Controller|loadSettings|loadEvents|apiFetch|reprocess|send-document" frontend/src/admin frontend/src`
- Settings UI: `rg -n "document_send_to|Memoria AI|Watcher Email|Diagnostica|settings" frontend/src docs`
- Event detail: `rg -n "selectedEvent|render.*Detail|workflow|missing_fields|feedback" frontend/src/admin`
- Auth shell: `rg -n "requireAdminSession|adminLoginPage|/admin|/setup|/login" backend/routes/admin_auth.js backend/server.js`

## Related Docs

- `docs/FRONTEND_ADMIN.md`
- `docs/API.md`
- `docs/UI_DESIGN_HANDOFF.md`
