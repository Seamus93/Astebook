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

## Verification

Per modifiche frontend:

- eseguire lint/build del progetto;
- verificare responsive se il layout cambia;
- per UI complesse o 3D usare screenshot/Playwright quando disponibile.
