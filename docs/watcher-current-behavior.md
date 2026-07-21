# Watcher IMAP - comportamento corrente

Data analisi: 2026-07-21.

## Entry point

L'entrypoint runtime del watcher IMAP e in `backend/server.js`.

- `startServer()` crea il watcher con `createEmailWatcher({ getSettings: getRuntimeSettings })`.
- Subito dopo l'avvio del server chiama `startEmailWatcherAfterDelay("server started")`.
- `startEmailWatcherAfterDelay()` legge `EMAIL_WATCHER_START_DELAY_SECONDS` con fallback 30 secondi e chiama `emailWatcher.start({ delaySeconds })`.
- L'endpoint manuale `POST /api/v1/admin/email-watcher/scan` chiama `emailWatcher.scanNow()`.

La logica del watcher e in `backend/lib/email_watcher.js`, nella funzione `createEmailWatcher()`; il lavoro IMAP effettivo viene eseguito da `pollMailbox(settings)`.

## Persistenza dello stato tra riavvii

Il watcher persiste uno stato su file, non nella tabella `email_watcher_state`.

- File: `EMAIL_WATCHER_STATE_FILE`, fallback `runtime/email-watcher-state.json`.
- Formato atteso: `{ "processed": [] }`.
- `readState()` crea il file se manca.
- `writeState()` salva solo gli ultimi 1000 elementi di `processed`.
- `resetEmailWatcherState()` e `forgetEmailWatcherMessageState()` agiscono sullo stesso file.

La tabella Prisma `email_watcher_state` esiste nello schema con `processed_ids`, ma il codice corrente del watcher non la legge e non la scrive. Se la tabella `email_watcher_state` e vuota, il comportamento corrente non cambia, perche la sorgente effettiva e il file runtime.

Nota: nel percorso corrente `pollMailbox()` crea `const processed = new Set(state.processed)`, ma non aggiunge nuovi message key al set durante la scansione. Di conseguenza il file viene riscritto con lo stesso contenuto letto, salvo reset/forget manuali.

## Identificatori usati

Il watcher usa:

- UID IMAP: si, cerca e fetch-a messaggi per UID.
- Message-ID: si, come `messageKey` primario quando presente; fallback `${mailbox}:${uid}`.
- `processed_ids`: no, non usa la tabella `email_watcher_state.processed_ids`.
- stato in memoria: si, ma solo per `running`, backoff transient e timer nel processo Node.
- file state `runtime/email-watcher-state.json`: si, campo `processed`.
- `email_watcher_state`: no.
- `mailbox_messages`: si, per deduplicare e indicizzare.

## Cosa succede al riavvio del container

Al riavvio:

1. Il processo Node riparte e ricrea `emailWatcher`.
2. Dopo il delay configurato parte una nuova scansione.
3. Lo stato in memoria (`running`, `consecutiveTransientFailures`, `suspendedUntil`, timer) viene perso.
4. Il watcher rilegge il file `runtime/email-watcher-state.json`, se presente nel volume persistente.
5. Il watcher consulta `mailbox_messages` per ogni UID trovato.

Il riavvio non usa un `last_uid` persistente. Non esiste oggi una baseline persistente che dica "riparti solo da UID maggiore di X".

## Tipo di scansione

Il watcher fa una scansione per UID recenti, ma non incrementale.

Comportamento corrente in `pollMailbox()`:

1. `client.search({ all: true }, { uid: true })`
2. `uids.slice(-settings.scanLimit).reverse()`
3. fetch a batch da 100 UID

Default:

- `EMAIL_WATCHER_SCAN_LIMIT`, fallback 500.
- `EMAIL_WATCHER_POLL_SECONDS`, fallback 120.

Classificazione richiesta:

- a) full mailbox scan: parziale. La search e `all`, ma poi limita agli ultimi `scanLimit` UID.
- b) scan incrementale: no.
- c) ricerca per UID > X: no.
- d) ricerca per date: no, non nel watcher automatico.

La ricerca per data esiste invece nel percorso `syncMailboxMessages()` in `backend/lib/mailbox_browser.js`, usato per sync/backfill mailbox, non dal watcher automatico.

## Deduplica corrente

Per ogni messaggio trovato il watcher cerca una riga in `mailbox_messages` tramite `findMailboxIndexMessage({ uid, mailbox, message_id })`.

Salta il messaggio se:

- esiste `event_id`; oppure
- `status === "mailbox_indexed"` e `processing_status === "mailbox_indexed"`.

Se la riga esiste con `processed=true`, il watcher costruisce uno stato effettivo che include il `messageKey`, cosi l'interceptor la considera gia processata.

Se il messaggio passa mittente e filtro file, il watcher salva/cache-a la mail e aggiorna `mailbox_messages` con:

- `processed: false`
- `status: "mailbox_indexed"`
- `processing_status: "mailbox_indexed"`
- `mail_cache`

## Implicazione del cutover

Dato il cutover:

- 553 righe `mailbox_messages.status = 'ignored'`
- 5 righe `mailbox_messages.status = 'processing'`
- tabella `email_watcher_state` vuota

Il watcher non e protetto dalla tabella vuota, perche non la usa. Inoltre non usa `last_uid`. Alla prossima scansione guardera gli ultimi `EMAIL_WATCHER_SCAN_LIMIT` UID della mailbox IMAP e confrontera ogni UID con `mailbox_messages`.

Le righe `status='ignored'` non vengono riconosciute esplicitamente come gia archiviate dal watcher. Tuttavia il watcher salta automaticamente solo righe con `event_id` oppure con coppia `status='mailbox_indexed'` e `processing_status='mailbox_indexed'`. Quindi `ignored` non e uno stato di skip esplicito nel watcher corrente.

