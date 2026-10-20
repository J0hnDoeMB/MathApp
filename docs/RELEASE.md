# Release policy

## Versioning

- **patch** (`1.x.y`): fix, test, docs, refactor senza cambi di comportamento
- **minor** (`1.x.0`): nuova funzione o cambiamento visibile
- **major** (`2.0.0`): rottura di config, storage o API

## Checklist di release

1. `npm test` verde (62 check), `npm run test:ui` verde (13 check), `npm run test:geo` verde (5 check) e `npm run test:py` verde.
2. `node test_server_cancel.mjs` e i test UI disponibili verdi.
3. `docs/ARCHITECTURE.md` e `CHANGELOG.md` aggiornati.
4. Nessun segreto, `settings.json`, `data/`, `.tools/` o path personale nel commit.
5. Tag annotato `vX.Y.Z` e release GitHub con note sintetiche.
6. CI verde sul commit taggato **prima** di annunciare la release.

## Branch protection

`main` deve richiedere:

- il check CI `tests` (workflow `syntax.yml`);
- niente force-push e niente cancellazione del branch;
- PR con review quando il progetto avrà altri contributor.

La protezione si configura dalle impostazioni GitHub del repo o via API; non è un file del repository.

## Compatibilità

- Node.js >= 18 per il core; Node LTS consigliato.
- Python/SymPy, faster-whisper e GeoGebra sono opzionali: la loro assenza non blocca chat e sessione.
- Le modifiche a `settings.json` e ai JSON in `data/` devono essere retrocompatibili o documentate nel CHANGELOG.
