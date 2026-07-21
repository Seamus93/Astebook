# Auto Process Mailbox - comportamento corrente

Data analisi: 2026-07-21.

## Entry point

Il cron "Auto process mailbox" viene creato in `backend/server.js` dentro `startServer()`:

- `mailboxAutoProcessor = createMailboxAutoProcessor(...)`
- `mailboxAutoProcessor.start({ delaySeconds: MAILBOX_AUTO_PROCESS_START_DELAY_SECONDS || 60 })`

La logica e in `backend/lib/mailbox_auto_processor.js`.

Endpoint amministrativi:

- `POST /api/v1/admin/mailbox/auto-process/run`: forza un batch immediato con `runNow()`.
- `GET /api/v1/admin/mailbox/auto-process/status`: restituisce lo stato runtime del cron.

## Settings

`resolveSettings()` legge runtime settings o env:

- `MAILBOX_AUTO_PROCESS_ENABLED` / `mailbox_auto_process_enabled`, fallback `false`.
- `MAILBOX_AUTO_PROCESS_INTERVAL_SECONDS` / `mailbox_auto_process_interval_seconds`, fallback `120`.
- `MAILBOX_AUTO_PROCESS_LIMIT` / `mailbox_auto_process_limit`, fallback `3`.

Il timer schedula sempre un nuovo giro, ma se `enabled=false` il giro termina senza processare.

## Query SQL equivalente

In modalita DB, `listPendingMailboxMessagesForProcessing()` in `backend/lib/mailbox_index.js` usa Prisma:

```js
prisma.mailboxMessage.findMany({
  where: {
    eventId: null,
    processed: false,
    uid: { not: null },
    senderAllowed: { not: false },
  },
  orderBy: [{ date: "asc" }, { lastSyncedAt: "asc" }],
  take,
})
```

SQL equivalente:

```sql
SELECT *
FROM mailbox_messages
WHERE event_id IS NULL
  AND processed = false
  AND uid IS NOT NULL
  AND sender_allowed IS DISTINCT FROM false
ORDER BY date ASC, last_synced_at ASC
LIMIT :batch_limit;
```

Per contare il backlog reale sul VPS:

```sql
SELECT count(*)
FROM mailbox_messages
WHERE event_id IS NULL
  AND processed = false
  AND uid IS NOT NULL
  AND sender_allowed IS DISTINCT FROM false;
```

## Campi usati

Il cron usa:

- `processed=false`: si.
- `event_id IS NULL`: si.
- `uid IS NOT NULL`: si.
- `sender_allowed IS NOT false`: si.
- `status`: no.
- `processing_status`: no.

Questo e il punto piu importante del cutover: `status='ignored'` non esclude una riga dal cron se la riga mantiene `processed=false`, `event_id IS NULL`, `uid` valorizzato e `sender_allowed` diverso da `false`.

## Batch e polling

- Batch massimo: `MAILBOX_AUTO_PROCESS_LIMIT` o runtime setting, fallback 3, clamp massimo 25.
- Intervallo: `MAILBOX_AUTO_PROCESS_INTERVAL_SECONDS` o runtime setting, fallback 120 secondi; `schedule()` impone minimo 30 secondi.
- Delay iniziale: `MAILBOX_AUTO_PROCESS_START_DELAY_SECONDS`, fallback 60 secondi.

Le candidate sono ordinate dalla piu vecchia alla piu recente (`date ASC`, poi `lastSyncedAt ASC`).

## Comportamento in caso di errore

Per ogni candidata il cron chiama `processMailboxMessage({ force: true })`.

Se una singola mail fallisce:

- l'errore viene catturato;
- la mail viene aggiunta a `failed_items`;
- il cron continua con le altre candidate del batch.

Se `processMailboxMessage()` intercetta un errore IMAP/process:

- aggiorna la riga mailbox con `status='process_failed'`;
- aggiorna `processing_status='process_failed'`;
- salva l'errore in `interceptor.error`;
- ritorna `ok:false`.

Alla fine del batch:

- `last_result` contiene candidate, processate e fallite;
- `last_error` diventa `N mail non processate` se ci sono fallimenti;
- il timer viene rischedulato se il giro era schedulato.

Nota critica: una riga fallita resta potenzialmente candidata al giro successivo se conserva `processed=false` ed `event_id IS NULL`, perche la query non esclude `status='process_failed'`.

## Risposta esplicita: se abilito Auto Process oggi, quante mail verrebbero processate?

Con il comportamento corrente, il cron non guarda `status`.

Dato il cutover dichiarato:

- 553 righe aggiornate a `status='ignored'`
- 5 righe aggiornate a `status='processing'`

la risposta non puo essere "5" solo perche 5 hanno `status='processing'`.

Se quelle 558 righe hanno ancora:

- `event_id IS NULL`
- `processed = false`
- `uid IS NOT NULL`
- `sender_allowed IS DISTINCT FROM false`

allora Auto Process oggi tenterebbe di processare 558 mail, a batch da 3 ogni 120 secondi con i default mostrati in UI.

Il numero esatto non e derivabile dal solo campo `status`; va contato con la query SQL sopra. Il rischio operativo corrente e che le 553 righe `ignored` siano ancora eleggibili, perche `ignored` non e un filtro del cron.

