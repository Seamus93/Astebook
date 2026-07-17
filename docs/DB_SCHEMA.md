# Database Schema

Astebook uses PostgreSQL with Prisma migrations.

Runtime deployment is managed by `docker-compose.yml`:

- `db`: PostgreSQL 17 with persistent data in Docker named volume `postgres_data_v17`.
- `app`: runs `prisma migrate deploy` before starting the Node server.

The initial database prepares durable tables for operational state. Mailbox listing is DB-backed in production: the IMAP watcher inserts or updates `mailbox_messages`, and the admin listing reads that table instead of opening a live IMAP listing.

## Connection

Default Docker connection:

```text
postgresql://astebook:astebook@db:5432/astebook?schema=public
```

CI uses the same credentials against the GitHub Actions PostgreSQL service on `localhost`.

## Prisma

- Schema: `prisma/schema.prisma`
- Migrations: `prisma/migrations`
- Apply migrations: `npm run db:migrate`
- Generate client: `npm run db:generate`

## Tables

```mermaid
erDiagram
  PROCESSING_EVENTS ||--o{ PROCESSING_STEPS : has

  PROCESSING_EVENTS {
    string id PK
    string source
    string status
    json metadata
    json request
    json result
    json error
    datetime received_at
    datetime updated_at
  }

  PROCESSING_STEPS {
    int id PK
    string event_id FK
    datetime at
    string level
    string message
    json data
  }

  MAILBOX_MESSAGES {
    string id PK
    string message_id
    int uid
    string mailbox
    string subject
    json from
    json to
    boolean seen
    boolean processed
    string event_id
    string status
  }

  EMAIL_WATCHER_STATE {
    int id PK
    json processed_ids
    datetime updated_at
  }

  RUNTIME_SETTINGS {
    string key PK
    string value
    datetime updated_at
  }

  EXTRACTION_FEEDBACK {
    string id PK
    string event_id
    string field_path
    json ai_value
    json corrected_value
    string rating
    datetime created_at
  }

  GEOCODE_CACHE {
    string key PK
    json value
    datetime created_at
    datetime updated_at
  }
```

## Migration Policy

Schema changes require:

- a Prisma migration;
- an update to this file;
- a CI run that applies migrations against PostgreSQL;
- a deploy through the standard pipeline so `prisma migrate deploy` runs before the app starts.
