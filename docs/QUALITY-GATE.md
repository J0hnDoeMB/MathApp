# Quality gate e feature freeze

MathApp è in **stabilizzazione**. La regola è: nessuna nuova feature finché il gate sotto non è verde.

## Core vs extra

**Core stabile**
- chat e sessioni
- storage locale
- sicurezza HTTP
- provider AI
- GeoGebra e SymPy
- impostazioni e diagnostica

**Extra (plugin opzionali)**
- quiz
- ripasso
- appunti / KB
- flashcard
- TTS
- dettatura
- stile/profilo

Gli extra restano dietro il gate core/full e, per la UI, dietro il loader `public/features.js`.

## Gate di qualità

1. `npm test` verde: **88 check** (23 moduli, 4 agente, 5 chat-service, 3 observability, 2 provider fallback, 4 session recovery, 41 security/sessione, 6 lock di istanza; oltre ai parser).
2. `npm run test:ui` verde: **22 check** browser (skip link e mobile 390 px inclusi).
3. `npm run test:xss` verde: **14 check** XSS self-contained.
4. `npm run test:geo` verde: **5 check** GeoGebra.
5. `npm run test:py` verde: **29 test** SymPy.
6. `npm run eval` verde (17 casi SymPy).
7. `npm run coverage` verde (soglia 65% righe; 69.9% misurato; c8); `npm run eval:ai` opzionale, con chiave e revisione umana.
8. `npm run package` produce lo zip sorgente versionato (worktree pulito, nessun file personale).
9. `main` protetto dal check CI `tests`; niente force-push/delete.
10. `.\start-mathapp.ps1 -Check` verde, incluso storage e backup scrivibili.
11. `GET /api/diagnostics` (o `/api/health`) verde: versione, Node, Python/SymPy/Whisper, provider, data dir, backup dir, porta, modo.

## Definition of done per una modifica

- test minimo che fallirebbe senza la modifica;
- nessuna regressione su sessione, stato GeoGebra, sicurezza o parsing;
- se è un extra: plugin/route isolato e toggle core/full;
- docs aggiornate (`ARCHITECTURE`, `CONTRACTS`, `DATA-MODEL`, `CHANGELOG`);
- CI verde sul commit.

## Cosa NON fare ora

- nuove feature nel core;
- nuovi file di stato persistenti senza schema/migrazione;
- chiamate dirette a provider/filesystem dentro la UI;
- modifiche a `server.mjs` con logica di dominio.

## Diagnostica rapida

```powershell
.\start-mathapp.ps1 -Check
```

oppure, con l'app avviata:

```powershell
curl http://127.0.0.1:8790/api/diagnostics
```
