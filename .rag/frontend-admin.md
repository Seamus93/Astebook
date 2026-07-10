# Frontend Admin Knowledge

Updated: 2026-07-10

## Entry Points

- `frontend/src/main.jsx`: React entry point.
- `frontend/src/App.jsx`: static admin shell markup served under `/admin`; imports `adminClient.js` on mount.
- `frontend/src/ConsoleAdmin.jsx`: dedicated `/admin/settings` page markup with collapsible settings sections.
- `frontend/src/adminClient.js`: thin initializer that wires admin controllers.
- `frontend/src/admin/apiClient.js`: authenticated fetch and token retry.
- `frontend/src/admin/detailController.js`: selected event loading, detail panes and action buttons.
- `frontend/src/admin/dom.js`: tiny DOM lookup helper.
- `frontend/src/admin/eventList.js`: event list loading and rendering.
- `frontend/src/admin/fileSections.js`: file/step grouping and file sections.
- `frontend/src/admin/html.js`: HTML escaping.
- `frontend/src/admin/settingsController.js`: settings loading/saving, saved-values panel and recipient deletion.
- `frontend/src/admin/shell.js`: sidebar collapse behavior.
- `frontend/src/admin/structuredView.js`: generic nested data rendering.
- `frontend/src/admin/toast.js`: toast rendering.
- `frontend/src/admin/workflowView.js`: workflow status rendering.
- `frontend/src/progressStepper.js`: progress/substep support.
- `frontend/src/latestFilePane.js`: latest file panel helpers.
- `frontend/src/styles.css`: all admin UI styles.

## Current Admin Client Responsibilities

`frontend/src/adminClient.js` now only:

- creates settings, detail and event-list controllers;
- opens/closes the settings modal;
- wires reveal buttons, sidebar toggle, settings submit and AI base URL hint;
- starts `loadSettings()` and `loadEvents()`.

## Module Split

Current modules:

- `frontend/src/admin/apiClient.js`: `apiFetch`, token handling, endpoint helpers.
- `frontend/src/admin/toast.js`: toast rendering.
- `frontend/src/admin/settingsController.js`: settings loading/saving, saved-values panel, recipient deletion.
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
- Settings are grouped in collapsible sections: SMTP, Watcher Email, Documenti e Invio, AI e OCR, Sicurezza e Utenti.
- Settings API is loaded with `GET /api/v1/admin/settings?reveal=1`.
- `Send to` (`document_send_to`) is shown as recipient chips in the saved-values panel.
- Clicking a recipient chip X posts `{ document_send_to: nextValue }` to `/api/v1/admin/settings`, reloads settings, and updates the input.
- Non-secret settings fields should be rendered as text fields, not password fields.
- Secret fields still use reveal buttons.

## Frontend Verification

- Build: `npm run build`.
- Lint only: `npm run lint`.
- Backend tests: `npm test`.
- Vite output is written to `frontend/dist` and served by Express under `/admin`.
