# Data model

Tutti i dati persistiti hanno uno **schema version** e vengono migrati in lettura. La validazione vive in `lib/schema.mjs`; la scrittura delle sessioni passa solo da `lib/session-store.mjs`.

## Session (`data/conversations/<id>.json`)

| Campo | Tipo | Note |
|---|---|---|
| `id` | string | id conversazione |
| `schemaVersion` | int | attuale `1` |
| `title` | string | max 90 |
| `model` | string | modello usato |
| `createdAt`, `updatedAt` | epoch ms | |
| `stateRevision` | int | monotona, per scartare snapshot vecchi |
| `messages` | Message[] | chat persistita |
| `cells` | AlgebraEntry[] | max 200 |
| `figures` | GeometryConstruction[] | max 60 |
| `figsIssued` | string[] | fid emessi dal server |
| `ggb` | string/null | base64 GeoGebra, max 8 MB |
| `view` | `{xmin,xmax,ymin,ymax,axes,grid}`/null | |
| `view3d` | bool | |
| `mode` | `"figure"`/`"algebra"`/null | |
| `tags` | string[] | max 8 |

### Message

```json
{ "role": "user|assistant", "content": "testo", "files": ["nome.pdf"] }
```

### AlgebraEntry

```json
{ "op": "diff", "expr": "x^2", "res": "2*x", "ai": false, "spiega": { "text": "..." } }
```

### GeometryConstruction

```json
{ "fid": "uuid", "title": "parabola", "commands": ["f(x)=x^2"], "msgIdx": 3, "view": "2d" }
```

## ReviewItem (`data/review.json`)

`id`, `convId`, `title`, `text`, `t`, `due`, `reps`, `ease`, `interval`, `lapses`, `type?`, `lastGrade?`, `lastT?`.
La pianificazione SM-2 è in `lib/review.mjs`.

## DocumentReference (`data/kb/index.json` + `chunks.json`)

`id`, `name`, `kind`, `convId`, `convIds?`, `addedAt`, `chars`, `chunks`, `file {path,name,ext,size,mime}`.
I blocchi sono `{docId,docName,kind,page,i,text}`.

## SettingsProfile (`settings.json`)

`provider`, `apiKey?`, `model`, `mode`, `level`, `whisperLanguage`, `backup`, `backupHours`.
La chiave non viene mai restituita dalle API, non finisce nei log e non è inclusa nei backup (`data/`).

## BackupSnapshot (`backups/*.zip`)

`file`, `size`, `t` (mtime). Retention: 7 zip; il backup contiene solo `data/`.

## Persistenza

I repository secondari (review/profile/KB) validano i record e scartano quelli malformati senza perdere il file.

Tutte le scritture JSON passano da `lib/json-store.mjs`: file temporaneo + rename atomico. Un file non parsabile viene rinominato in `.corrupt-<epoch>` e sostituito dal fallback in lettura; i file `.tmp.*`/`.corrupt-*` non sono sessioni valide. Dettagli in [`PERSISTENCE.md`](PERSISTENCE.md).

## Versioning e migrazione

- `schemaVersion` assente → migrazione a `1` in lettura (`migrateSession`).
- I campi mancanti ricevono default sicuri; i campi sconosciuti vengono preservati.
- Input di stato non valido (id, revisione, tipi, limiti) → `400`.
- Revisione `<=` precedente → `200 {stale:true}` e nessuna sovrascrittura.
- Una modifica futura allo schema deve incrementare `SCHEMA_VERSION` e aggiungere una migrazione; mai riusare un numero.
