# UI Design Handoff

Standard operativo per passare una UI/UX da Figma a Bolt e poi al repository Astebook senza perdere la logica di prodotto esistente.

## Obiettivo

Usare Figma per definire l'esperienza visiva e Bolt per produrre un prototipo tecnico utile, senza trattare l'output di Bolt come sostituto diretto del progetto finale.

Flusso standard:

```text
Figma design
-> Bolt prototype
-> GitHub branch dedicata
-> integrazione manuale nel frontend reale
-> review, build, test
-> merge
```

## Regole

- Non importare mai un prototipo Bolt direttamente su `main`.
- Non sovrascrivere backend, auth, pipeline, API client, routing admin o logica eventi con codice generato.
- Usare Bolt per estrarre layout, componenti UI, naming e CSS utili.
- Integrare nel repository finale solo modifiche compatibili con `frontend/src` e con i controller esistenti.
- Mantenere la UI admin come backoffice operativo, non come landing page.
- Conservare protezione server-side di `/admin`, login/setup Express e API protette.

## Preparazione Figma

Creare frame separati e nominati:

- `astebook-admin-desktop`
- `astebook-admin-mobile`
- eventuali stati: `settings`, `empty`, `error`, `modal-filters`, `modal-notifications`

Ogni frame deve essere un vero frame Figma, non solo un gruppo.

Per copiare il link corretto:

1. Selezionare il frame.
2. Click destro.
3. `Copy/Paste as`.
4. `Copy link to selection`.

Non usare il link generico del file Figma.

## Import in Bolt

Usare un solo progetto Bolt per desktop e mobile dello stesso prodotto.

1. Importare prima il frame desktop con `Import from Figma`.
2. Importare poi il frame mobile nello stesso progetto.
3. Specificare che sono breakpoint della stessa app, non due app separate.

Prompt consigliato dopo il secondo import:

```text
Questo frame mobile e la variante responsive dello stesso prodotto Astebook.
Unisci desktop e mobile in un'unica app responsive.
Desktop: sidebar sinistra + area dettaglio.
Mobile: dettaglio sopra, lavorazioni sotto, bottom navigation fissa.
Non creare due app separate. Usa gli stessi componenti con CSS responsive.
Non inventare backend: usa dati mock.
```

## Collegamento GitHub

Da Bolt:

1. Collegare GitHub.
2. Importare `Seamus93/Astebook` solo se serve lavorare vicino al codice reale.
3. Creare una branch dedicata.

Branch consigliate:

```text
figma-ui-prototype
ui-redesign-experiment
figma-admin-refresh
```

Se Bolt crea un progetto nuovo separato, esportare o collegare quel progetto a una repository separata e poi portare a mano le parti utili in Astebook.

## Integrazione nel Repo Reale

Portare a mano:

- componenti visuali compatibili;
- classi CSS;
- spaziature;
- stati responsive;
- icone e label;
- eventuali empty/error states.

Non portare automaticamente:

- mock API;
- router generati;
- autenticazione generata;
- nuovo backend;
- persistenza generata;
- package non necessari;
- layout che nasconde o rimuove funzioni operative esistenti.

## Checklist Prima di Merge

- La UI funziona su `/admin`.
- La pagina `/admin/settings` resta accessibile.
- Login/setup server-side restano invariati.
- Nessun segreto o URL privato nel codice.
- Mobile senza overlap con bottom nav.
- Footer e link non coprono contenuti.
- `npm run build` passa.
- Test pertinenti passano.
- Diff limitato a frontend/docs salvo necessità esplicita.

## Prompt Base per Bolt

```text
Lavora sul progetto Astebook come console admin B2B.
Usa il frame Figma importato come riferimento visivo, ma conserva la struttura reale del progetto.
Non sostituire backend, autenticazione, API client o pipeline.
Implementa solo UI React/CSS compatibile con frontend/src.
Mantieni stile backoffice SaaS, bianco/nero con accento magenta, card radius max 8px, icone lineari.
Usa dati mock solo nel prototipo, non nel repository finale.
Prepara componenti riutilizzabili e responsive.
```

## Criterio di Successo

Il prototipo Bolt e utile quando aiuta a decidere e trasferire layout, componenti e stati visuali.

Il codice finale resta Astebook: integrato, protetto, testato e coerente con la pipeline reale.
