# Media Standard

## Rule

I file media binari non devono restare sciolti nella root del repository.

## Application Assets

Asset applicativi serviti all'utente finale devono vivere nel flusso previsto dall'app.

Default:

- immagini e video di sito salvati su Cloudinary;
- non nel repository;
- non nel database binario locale;
- eccezioni solo se documentate.

## Cloudinary Registry

Il registro applicativo dei media Cloudinary deve contenere almeno:

- `asset_key`;
- `asset_type`;
- `public_id`;
- `secure_url`;
- metadata minimi per rendering.

Il frontend non deve dipendere da file media locali per asset di sito. Il backend deve risolvere mapping verso Cloudinary e riallinearlo se la riga locale manca.

## Cloudinary Structure

Struttura standard indicativa:

```text
<project>/image/site
<project>/image/property-types
<project>/video/site
```

Nuove famiglie media devono restare sotto root progetto:

```text
<project>/<categoria>/<sottocategoria>
```

Naming esplicito e coerente.

## Local `/media`

La directory `/media` e opzionale.

Se presente:

- solo materiale temporaneo non ancora migrato;
- non e target finale dei media di sito.

Se tutti gli asset sono gia migrati e verificati, `/media` puo non esistere.

## Migration

Quando si migrano asset locali:

- usare script ripetibile di progetto;
- produrre report dei `public_id` generati;
- salvare report fuori repository o in path runtime dedicati;
- prima di eliminare un media locale verificare import provider o record DB.

## Worktree Hygiene

Report di migrazione o export operativi non devono sporcare il worktree deployato.
