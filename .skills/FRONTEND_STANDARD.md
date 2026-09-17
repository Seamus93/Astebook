# Frontend Standard

## Default Stack

- React.
- Vite.
- TypeScript.
- Tailwind.
- Shadcn UI.
- TanStack Query.

Alternative:

- Next.js per SEO/SSR.
- React Native per mobile.

## Backoffice UX

Per strumenti SaaS, CRM, backoffice e operational tool:

- privilegiare interfacce dense ma ordinate;
- usare navigazione prevedibile;
- evitare layout marketing o hero decorativi;
- ottimizzare scanning, confronto e azioni ripetute;
- rendere comuni workflow ergonomici e completi.

## UI Controls

Usare:

- icone per bottoni tool;
- segmented controls per mode;
- toggle/checkbox per booleani;
- slider/stepper/input per numeri;
- menu per set di opzioni;
- tab o sezioni espandibili per viste correlate;
- bottoni testuali solo per comandi chiari.

Preferire lucide/material/icon library gia presente nel progetto.

## Layout Rules

- Non mettere card dentro card.
- Usare cards per item ripetuti, modali o tool realmente incorniciati.
- Page sections devono essere full-width band o layout non incorniciati.
- Evitare orbs, gradient blobs e decorazioni non funzionali.
- Testo e controlli non devono sovrapporsi.
- I testi devono rientrare nei container su mobile e desktop.
- Non scalare font-size con viewport width.
- Letter spacing deve restare 0 salvo design system esplicito.

## Settings and Admin Pages

Quando una configurazione supera pochi campi:

- evitare modal fullscreen;
- creare pagina dedicata protetta;
- raggruppare le impostazioni in sezioni/tendine;
- mostrare valori salvati in modo leggibile;
- distinguere secret da campi non sensibili;
- rendere le azioni distruttive esplicite e reversibili dove possibile.

## Figma to Bolt UI Handoff

Per nuove UI/UX operative usare il flusso standard:

```text
Figma design
-> Bolt prototype
-> GitHub branch dedicata
-> integrazione manuale nel frontend reale
-> review, build, test
-> merge
```

Regole:

- creare frame Figma separati per desktop, mobile e stati chiave;
- copiare i link con `Copy link to selection` dal frame, non dal file;
- importare desktop e mobile nello stesso progetto Bolt come breakpoint della stessa app;
- non creare due app separate per desktop e mobile;
- usare Bolt per prototipare layout, componenti e CSS;
- non trattare l'output Bolt come sorgente autoritativa del progetto finale;
- non pushare codice generato direttamente su `main`;
- usare branch dedicate come `figma-ui-prototype`, `ui-redesign-experiment` o `figma-admin-refresh`;
- integrare manualmente nel repository reale solo componenti, classi, spaziature, stati responsive e pattern visuali utili;
- preservare backend, autenticazione, API client, pipeline, routing e controller esistenti.

Prompt base per Bolt:

```text
Lavora sul progetto come console admin B2B.
Usa il frame Figma importato come riferimento visivo, ma conserva la struttura reale del progetto.
Non sostituire backend, autenticazione, API client o pipeline.
Implementa solo UI/CSS compatibile con il frontend esistente.
Usa dati mock solo nel prototipo, non nel repository finale.
Prepara componenti riutilizzabili e responsive.
```

## Verification

Per modifiche frontend:

- eseguire lint/build del progetto;
- verificare responsive se il layout cambia;
- per UI complesse o 3D usare screenshot/Playwright quando disponibile.
