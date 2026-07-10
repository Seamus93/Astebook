# Database and API Standard

## Database Defaults

- Database default: PostgreSQL.
- ORM default: Prisma.
- Alternativa ORM: Drizzle.

## Database Schema Rules

Ogni tabella deve avere:

- `id` UUID;
- `created_at`;
- `updated_at`.

Valutare:

- soft delete;
- audit trail;
- archiviazione.

Ogni relazione deve avere:

- foreign key;
- indice appropriato;
- constraint.

## Database Performance

Ogni campo usato per:

- foreign key;
- filtro;
- ricerca;
- ordinamento;

deve essere valutato per indicizzazione.

Documentare gli indici.

## Migration Rules

Ogni modifica schema richiede:

- migrazione Prisma o equivalente;
- aggiornamento `docs/DB_SCHEMA.md`;
- aggiornamento ERD;
- aggiornamento documentazione collegata.

## CRUD Policy

- Generare CRUD completi solo per entita business.
- Per entita tecniche generare esclusivamente le operazioni necessarie.

## Backoffice First

Per ogni business entity generare, salvo diversa indicazione:

- CRUD API;
- CRUD UI;
- filtri;
- ricerca;
- paginazione;
- export CSV.

L'applicazione deve essere amministrabile da UI.

## API Standards

- Default: REST.
- GraphQL solo se necessario.
- API pubbliche versionate.
- Formato versioning:
  - `/api/v1/*`
  - `/api/v2/*`

Ogni endpoint deve avere:

- validazione input;
- validazione output dove utile;
- gestione errori;
- documentazione.

Generare OpenAPI/Swagger per API pubbliche o backoffice articolati.

## API Documentation

`docs/API.md` deve includere:

- endpoint;
- metodo HTTP;
- auth richiesta;
- payload;
- response;
- errori principali;
- side effects rilevanti.
