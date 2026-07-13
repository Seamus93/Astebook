# Frontend Admin Knowledge

Updated: 2026-07-10

## Entry Points

- `frontend/src/main.jsx`: React entry point.
- `frontend/src/App.jsx`: static admin shell markup served under `/admin`; imports `adminClient.js` on mount.
- `frontend/src/ConsoleAdmin.jsx`: dedicated `/admin/settings` page markup with searchable settings section view.
- `frontend/src/adminClient.js`: thin initializer that wires admin controllers.
- `frontend/src/admin/apiClient.js`: authenticated fetch and token retry.
- `frontend/src/admin/detailController.js`: selected event loading, detail panes and action buttons.
- `frontend/src/admin/dom.js`: tiny DOM lookup helper.
- `frontend/src/admin/eventList.js`: event list loading and rendering.
- `frontend/src/admin/fileSections.js`: file/step grouping and file sections.
- `frontend/src/admin/html.js`: HTML escaping.
- `frontend/src/admin/learningController.js`: auto-learning feedback summary panel.
- `frontend/src/admin/settingsController.js`: settings loading/saving, saved-values panel and recipient deletion.
- `frontend/src/admin/shell.js`: sidebar collapse behavior.
- `frontend/src/admin/structuredView.js`: generic nested data rendering.
- `frontend/src/admin/toast.js`: toast rendering.
- `frontend/src/admin/workflowView.js`: workflow status rendering.
- `frontend/src/progressStepper.js`: progress/substep support.
- `frontend/src/latestFilePane.js`: latest file panel helpers.
- `frontend/src/styles.css`: CSS entrypoint imported by `App.jsx`; contains only `@import` statements for partials.
- `frontend/src/styles/base.css`: tokens, reset, shell/sidebar/search/buttons.
- `frontend/src/styles/base/*.css`: base submodules for tokens, reset, shell, header and buttons.
- `frontend/src/styles/events.css`: event list, event badges and detail heading basics.
- `frontend/src/styles/workflow.css`: workflow status and analysis substepper.
- `frontend/src/styles/panels.css`: dashboard panes, structured data sections, file sections and steps.
- `frontend/src/styles/panels/*.css`: panel submodules for layout, data view, sections and steps.
- `frontend/src/styles/overlays.css`: modal, notification and toast styles.
- `frontend/src/styles/settings.css`: settings page, settings forms, feedback form and recipient chips.
- `frontend/src/styles/settings/*.css`: settings submodules for page, forms, summary, feedback and recipients.
- `frontend/src/styles/responsive.css`: responsive layout rules.

## Current Admin Client Responsibilities

`frontend/src/adminClient.js` now only:

- creates settings, learning, detail and event-list controllers;
- opens/closes the settings modal;
- wires reveal buttons, sidebar toggle, settings submit and AI base URL hint;
- starts `loadSettings()` and `loadEvents()`.

## Module Split

Current modules:

- `frontend/src/admin/apiClient.js`: `apiFetch`, token handling, endpoint helpers.
- `frontend/src/admin/toast.js`: toast rendering.
- `frontend/src/admin/settingsController.js`: settings loading/saving, saved-values panel, recipient deletion.
- `frontend/src/admin/learningController.js`: loads `/api/v1/extraction-feedback/summary` and renders AI memory metrics.
- `frontend/src/admin/eventList.js`: events fetch/list rendering.
- `frontend/src/admin/detailController.js`: selected event loading and action buttons.
- `frontend/src/admin/structuredView.js`: generic key/value display helpers.
- `frontend/src/admin/workflowView.js`: workflow step status rendering.
- `frontend/src/admin/fileSections.js`: file/step grouping and file sections.
- `frontend/src/admin/dom.js`: tiny DOM utilities if still useful.
- `frontend/src/adminClient.js`: thin initializer that wires modules.

## Settings Page

- Settings are displayed as a dedicated protected page at `/admin/settings`, not as a modal.
- The dashboard button navigates to `/admin/settings`; the page's Dashboard button navigates back to `/admin/`.
- Settings are grouped in a searchable section view: SMTP, Watcher Email, Documenti e Invio, AI e OCR, Sicurezza e Utenti, Memoria AI.
- Settings API is loaded with `GET /api/v1/admin/settings?reveal=1`.
- `Send to` (`document_send_to`) is shown as recipient chips in the saved-values panel.
- The Memoria AI section includes memory settings plus an Autoapprendimento AI panel with correction totals, scopes, top fields and recent feedback.
- The Watcher Email section includes a manual "Scansiona ora" action calling `POST /api/v1/admin/email-watcher/scan`.
- The Documenti e Invio section includes a manual "Invia ultimo documento" action.
- The API AI e OCR section includes a manual "Analizza ultima mail" action using reprocess with `skip_auto_send`.
- Clicking a recipient chip X posts `{ document_send_to: nextValue }` to `/api/v1/admin/settings`, reloads settings, and updates the input.
- Non-secret settings fields should be rendered as text fields, not password fields.
- Secret fields still use reveal buttons.

## Frontend Verification

- Build: `npm run build`.
- Lint only: `npm run lint`.
- Backend tests: `npm test`.
- Vite output is written to `frontend/dist` and served by Express under `/admin`.
