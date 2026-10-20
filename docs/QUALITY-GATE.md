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

1. `npm test` verde: **64 check** (19 moduli, 4 agente, 4 chat-service, 37 security/sessione).
2. `npm run test:ui` verde: **15 check** browser.
3. `npm run test:geo` verde: **5 check** GeoGebra.
4. `npm run test:py` verde: **29 test** SymPy.
5. `main` protetto dal check CI `tests`; niente force-push/delete.
6. `.\start-mathapp.ps1 -Check` verde, incluso storage e backup scrivibili.
7. `GET /api/diagnostics` (o `/api/health`) verde: Node, Python/SymPy/Whisper, provider, data dir, backup dir, porta, modo.

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
