# Piano minimo di hardening mailbox

Data proposta: 2026-07-21.

Questo documento propone una soluzione minima. Non implementa modifiche.

## Obiettivi

- Introdurre `last_uid` persistente.
- Usare la tabella `email_watcher_state`.
- Fare lavorare il watcher solo su UID maggiori della baseline.
- Fare lavorare il cron solo su righe indicizzate e senza evento.
- Impedire doppie elaborazioni.
- Mantenere compatibilita con il DB esistente.

## Problemi correnti da correggere

1. Il watcher non usa `email_watcher_state`; usa `runtime/email-watcher-state.json`.
2. Il watcher non ha `last_uid`; ogni giro cerca `all` e limita agli ultimi N UID.
3. Il cron non filtra `status`, quindi `ignored`, `processing` o `process_failed` possono restare eleggibili se `processed=false`.
4. Non c'e claim atomico della riga mailbox prima di processarla.
5. Gli stati `status` e `processing_status` non sono una state machine vincolante.

## Schema dati minimo

Estendere `email_watcher_state` mantenendo compatibilita:

- `id`: resta default 1.
- `processed_ids`: mantenuto per compatibilita.
- nuovo `last_uid Int?`.
- nuovo `mailbox String @default("INBOX")` oppure chiave per mailbox se si vuole supportare piu mailbox.
- opzionale `baseline_at DateTime?`.

Compatibilita:

- Se la riga non esiste, crearla all'avvio con `id=1`.
- Se `last_uid` e null, inizializzarlo con una baseline sicura senza processare storico.
- Conservare lettura del file JSON solo come migrazione una tantum o fallback controllato.

## Baseline sicura

Alla prima attivazione dopo il cutover:

1. Aprire IMAP.
2. Leggere il massimo UID corrente della mailbox.
3. Salvare `email_watcher_state.last_uid = max_uid`.
4. Non indicizzare messaggi <= baseline.

Da quel momento il watcher cerca solo:

```text
UID > last_uid
```

Alla fine di una scansione riuscita, aggiornare `last_uid` al massimo UID osservato, anche per messaggi scartati per mittente o filename. Cosi il watcher non torna sullo storico.

## Watcher: comportamento proposto

Flusso minimo:

1. Leggere o creare `email_watcher_state`.
2. Se `last_uid` e null, impostare baseline al massimo UID IMAP e terminare.
3. Cercare solo UID maggiori:

```js
client.search({ uid: `${lastUid + 1}:*` }, { uid: true })
```

oppure l'equivalente supportato da ImapFlow.

4. Fetch a batch.
5. Upsert in `mailbox_messages` solo nuovi messaggi.
6. Per messaggi processabili impostare:

```text
status = 'mailbox_indexed'
processing_status = 'mailbox_indexed'
event_id = NULL
processed = false
```

7. Per messaggi ignorati impostare:

```text
status = 'ignored'
processing_status = 'ignored'
processed = true
```

8. Aggiornare `last_uid`.

## Cron: query proposta

Il cron dovrebbe lavorare solo su righe pronte:

```sql
SELECT *
FROM mailbox_messages
WHERE status = 'mailbox_indexed'
  AND event_id IS NULL
  AND uid IS NOT NULL
  AND sender_allowed IS DISTINCT FROM false
ORDER BY date ASC, last_synced_at ASC
LIMIT :batch_limit;
```

La richiesta specifica indica almeno:

```sql
status = 'mailbox_indexed'
AND event_id IS NULL
```

Consiglio di mantenere anche `uid IS NOT NULL` e `sender_allowed IS DISTINCT FROM false`. Il filtro `processed=false` puo restare durante la transizione, ma a regime `status='mailbox_indexed'` dovrebbe essere il gate principale.

## Claim atomico anti doppia elaborazione

Prima di processare una mail, il cron dovrebbe fare un claim atomico:

```sql
UPDATE mailbox_messages
SET status = 'processing',
    processing_status = 'processing',
    last_synced_at = now()
WHERE id = :id
  AND status = 'mailbox_indexed'
  AND event_id IS NULL
RETURNING *;
```

Se `RETURNING` non restituisce righe, un altro worker o processo ha gia preso la mail.

Dopo il processamento:

- successo:

```text
event_id = <id evento>
status = <status evento o 'extracting'>
processing_status = 'extracting'
processed = true
```

- duplicato gia esistente:

```text
event_id = <id evento esistente>
status = <status evento>
processing_status = <status evento>
processed = true
```

- fallimento recuperabile:

```text
status = 'process_failed'
processing_status = 'process_failed'
processed = false
```

Con la nuova query, `process_failed` non rientra nel cron automaticamente.

## Migrazione compatibile con il DB esistente

Passi minimi:

1. Aggiungere colonne nullable a `email_watcher_state`.
2. Creare o aggiornare riga `id=1`.
3. Durante deploy, se non esiste `last_uid`, impostarlo da IMAP max UID corrente oppure da una variabile operativa di baseline.
4. Lasciare `processed_ids` esistente.
5. Non cancellare `processed` da `mailbox_messages`; usarlo come compatibilita UI/storico.
6. Aggiornare il cron per ignorare tutto cio che non e `status='mailbox_indexed'`.

## Cutover operativo consigliato

Prima di abilitare Auto Process:

1. Contare le candidate correnti con la query attuale del cron.
2. Contare le candidate con la query proposta.
3. Verificare che le 553 righe `ignored` abbiano `processed=true` oppure, dopo hardening, che il cron le escluda via `status`.
4. Impostare `last_uid` alla baseline IMAP corrente.
5. Abilitare watcher.
6. Abilitare cron.

Query di confronto:

```sql
-- Query corrente: backlog che il cron processerebbe oggi
SELECT count(*)
FROM mailbox_messages
WHERE event_id IS NULL
  AND processed = false
  AND uid IS NOT NULL
  AND sender_allowed IS DISTINCT FROM false;

-- Query proposta: backlog ammesso dopo hardening
SELECT count(*)
FROM mailbox_messages
WHERE status = 'mailbox_indexed'
  AND event_id IS NULL
  AND uid IS NOT NULL
  AND sender_allowed IS DISTINCT FROM false;
```

