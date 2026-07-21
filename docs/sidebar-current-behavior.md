# Sidebar mailbox amministrativa - comportamento corrente

Data analisi: 2026-07-21.

## Caricamento iniziale della sidebar

La sidebar amministrativa e gestita da `frontend/src/admin/eventList.js`.

All'avvio `loadEvents()` esegue:

1. `GET /api/v1/processing-events`
2. `GET /api/v1/admin/mailbox/messages?limit=30`

La funzione frontend che carica la mailbox e `fetchMailboxMessages()`.

Endpoint backend:

- `GET /api/v1/admin/mailbox/messages`
- alias: `GET /api/v1/admin/email-watcher/messages`

Entrambi passano da `handleMailboxMessages()` in `backend/server.js`, che chiama `listMailboxMessages()` in `backend/lib/mailbox_browser.js`.

## Da dove legge le email

`listMailboxMessages()` chiama `listMailboxIndexMessages()` in `backend/lib/mailbox_index.js`.

In produzione, se `DATABASE_URL` e presente e `MAILBOX_INDEX_FILE` non e forzato, `useMailboxDb()` e true. Quindi la sidebar legge da:

- `mailbox_messages`: si.
- `processing_events`: si, ma separatamente per la lista eventi e per collegare visualmente gli eventi gia caricati.
- IMAP live: no nel caricamento normale della sidebar.

Query Prisma della mailbox:

```js
prisma.mailboxMessage.findMany({
  where: includeAllSenders ? {} : { senderAllowed: { not: false } },
  orderBy: [{ date: "desc" }, { lastSyncedAt: "desc" }],
  take,
})
```

Con `limit=30`, il backend prende fino a `limit * 3` righe se non c'e ricerca testuale, massimo 500, poi filtra in memoria e restituisce `limit`.

## Quando parte ancora IMAP live dalla UI

Esistono ancora percorsi UI che aprono connessioni IMAP live:

1. Se `GET /api/v1/admin/mailbox/messages?limit=30` restituisce zero messaggi, `loadEvents()` chiama `startInitialMailboxSync()`.
2. `startInitialMailboxSync()` chiama `POST /api/v1/admin/mailbox/sync`.
3. Il refresh/scansione watcher in `scanWatcherThenReload()` chiama `POST /api/v1/admin/email-watcher/scan` e poi `POST /api/v1/admin/mailbox/sync`.

`POST /api/v1/admin/mailbox/sync` avvia `syncMailboxMessages()` in background. Questa funzione apre una connessione IMAP, cerca messaggi da indicizzare e poi salva in `mailbox_messages`.

Quindi:

- caricamento sidebar normale: DB/cache mailbox, non IMAP live;
- sync storico/backfill dalla UI: si, IMAP live;
- scansione watcher manuale dalla UI: si, IMAP live.

## Perche compare "Mailbox IMAP non caricata: timeout dopo 18s"

Il timeout nasce dal wrapper condiviso `backend/lib/imap_operation_lock.js`.

`withTimeout()` produce errori nel formato:

```text
Operazione IMAP timeout dopo <timeoutMs>ms
```

Il valore del timeout dipende dall'operazione:

- watcher: `EMAIL_WATCHER_IMAP_TIMEOUT_SECONDS`, fallback 180 secondi;
- sync mailbox: `MAILBOX_SYNC_TIMEOUT_SECONDS`, fallback 180 secondi;
- process singola mail: `MAILBOX_PROCESS_TIMEOUT_SECONDS`, fallback 180 secondi.

Se in produzione appare "timeout dopo 18s", significa che il timeout effettivo per quella chiamata e configurato a circa 18 secondi oppure che il frontend sta normalizzando il messaggio in secondi. Nel codice sorgente corrente il fallback documentato e 180 secondi; quindi 18s e quasi certamente configurazione env/runtime di produzione o una trasformazione UI del messaggio, non il default del repository.

Il caso piu probabile nella sidebar e:

1. la UI prova a eseguire `POST /api/v1/admin/mailbox/sync`;
2. `syncMailboxMessages()` apre IMAP live;
3. `withImapRetries()` passa da `runExclusiveImapOperation()`;
4. `withTimeout()` scade;
5. `startMailboxSync()` registra l'errore in `mailboxSyncStatus.last_error`;
6. la UI mostra il fallimento del caricamento/sync IMAP.

## Risposte sintetiche richieste

- Endpoint chiamato dalla sidebar per caricare la lista: `GET /api/v1/admin/mailbox/messages?limit=30`.
- Funzione backend eseguita: `handleMailboxMessages()` -> `listMailboxMessages()` -> `listMailboxIndexMessages()`.
- Connessione IMAP live dalla UI: non per il caricamento normale; si per sync/backfill (`POST /api/v1/admin/mailbox/sync`) e scansione watcher (`POST /api/v1/admin/email-watcher/scan`).

