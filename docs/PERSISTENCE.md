# Persistence

MathApp usa JSON locale con una policy esplicita, non accessi ad hoc sparsi.

## Contratto

`lib/json-store.mjs`:

```text
readJson(file, fallback) -> value
writeJsonAtomic(file, value) -> { ok, error? }
```

- **Scrittura atomica**: file temporaneo nella stessa directory, poi `rename` sul file finale. Un crash non lascia un JSON troncato al posto di quello valido.
- **Lettura corrotta**: il file non parsabile viene rinominato in `<file>.corrupt-<epoch>` e viene restituito il fallback. L'errore viene scritto in `mathapp.log`.
- **File assente**: fallback senza errore (primo avvio).
- **Directory**: creata automaticamente dal writer.

## Repository

| Repository | File | Schema |
|---|---|---|
| Sessioni | `data/conversations/<id>.json` | `schemaVersion: 1` |
| Ripasso | `data/review.json` | lista SM-2 |
| Profilo/stile | `data/profile.json` | lista preferenze |
| KB index/chunks | `data/kb/index.json`, `chunks.json` | documenti + blocchi |
| Settings | `settings.json` | config atomico separato |

Le route non leggono/scrivono JSON direttamente: usano `lib/session-store.mjs`, `lib/kb.mjs`, `lib/profile.mjs`, `lib/storage.mjs`.

## Regole

1. Ogni nuovo dato persistente deve passare da `writeJsonAtomic` e avere uno schema/versione.
2. Un file corrotto non deve bloccare l'app: quarantena + fallback.
3. I backup includono `data/`; non includono `settings.json` (chiave API).
4. I file temporanei `.tmp.*` e `.corrupt-*` non sono sessione valide e vengono ignorati.
5. Le migrazioni avvengono in lettura (`migrateSession`); nessun dato legacy viene rifiutato in blocco.

## Instance lock

`data/.mathapp-instance.lock` contiene PID, host, porta e timestamp di avvio del processo attivo. Serve a rifiutare un secondo processo sulla stessa directory; un lock rimasto da un crash viene recuperato quando il PID non è più attivo o proviene da un altro host. È un file operativo (circa 100 byte) e può finire in un backup: non contiene dati utente. Usare `MATHAPP_DATA_DIR` per eseguire test o istanze isolate.

Per ripristinare: fermare il server, eseguire `node scripts/restore-backup.mjs [file.zip]`; i dati precedenti vengono conservati in `data.pre-restore-<timestamp>`.

## Test

`test/test_modules.mjs` verifica roundtrip atomico, assenza di `.tmp`, quarantena di un file corrotto e fallback su file mancante.
