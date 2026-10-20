# Changelog

## v1.5.3 - 2026-10-20

### Changed
- API routes extracted from `server.mjs` into `routes/` (settings, library, conversations, chat); server is now ~60 lines.
- CI runs a browser smoke test (new chat, session restore, view state) with puppeteer-core + Edge, plus syntax checks for routes.
- Test suite: **42 Node checks** (10 module + 4 agent + 28 security/session) and **7 browser smoke checks**.

## v1.5.2 - 2026-10-20

### Added
- `test_agent.mjs`: loop agente con upstream finto (tool call -> SymPy -> verifica -> done), senza rete o chiavi.
- Test di sessione nel security smoke: salvataggio stato, persistenza ggb/cells/view, revisione stale e presenza in cronologia.
- `MATHAPP_DATA_DIR` / `MATHAPP_BACKUP_DIR` per test isolati.
- `docs/ROADMAP.md`, `docs/RELEASE.md`, `docs/ONBOARDING.md` e contratti in `docs/ARCHITECTURE.md`.

### Changed
- `npm test` esegue **37 check** (10 moduli + 4 agente + 23 sicurezza/sessione).

## v1.5.1 - 2026-10-20

### Fixed
- CI: installa Python/SymPy prima dei test Node, esegue `test_modules.mjs` e il check di sintassi su tutti i moduli `lib/`; il test `/api/compute` viene saltato se SymPy non e' disponibile.

## v1.5.0 - 2026-10-20

### Changed
- Architectural refactor: `server.mjs` is now the HTTP shell (~818 lines, from ~1,688) and domain services live in `lib/`: `storage`, `kb`, `profile`, `sympy`, `geogebra`, `documents`, `audio`, `prompts`, `tools`, `agent`, `levels`, `util`. Public HTTP behavior unchanged.
- `docs/ARCHITECTURE.md` documents the module map, dependency direction and remaining route split.
- `test_modules.mjs`: 10 direct checks for levels, prompts, tools, KB, SM-2, cache and audio types; `npm test` now runs 29 checks.
- Detail levels are **Auto / Sintetico / Dettagliato / Approfondito** (no school levels); legacy values are migrated.

## v1.4.0 - 2026-10-19

### Added
- **Windows setup**: `setup.ps1` scarica Node.js LTS portatile in `.tools\` (nessun admin) e prepara l'ambiente; `-Math` aggiunge Python/SymPy/pypdf, `-Full` anche faster-whisper, `-Check` solo diagnostica.
- `requirements.txt` / `requirements-whisper.txt` e guida [`docs/SETUP-WINDOWS.md`](docs/SETUP-WINDOWS.md).
- `start-mathapp.ps1` rileva il Node portatile di `.tools\`.

### Changed
- Livelli di dettaglio al posto dei livelli scolastici: **Auto, Sintetico, Dettagliato, Approfondito** (i vecchi valori `base`/`superiore`/`universita` vengono migrati).

## v1.3.0 - 2026-10-19

### Added
- **Livello di spiegazione** (`settings.level`): Auto, Scuola media, Scuola superiore, Università; il system prompt adatta lessico e formalismo.
- **Riepilogo verifica** sotto ogni risposta: conteggio dei calcoli esatti SymPy, oppure avviso se la matematica non è passata dal calcolo simbolico.
- **Inizia da qui**: tre esempi cliccabili nella chat vuota, nascosti al primo messaggio e ripristinati con Nuova chat.
- **Privacy e chiave API**: nota esplicita in Impostazioni e README (storage locale, provider, backup che escludono la chiave).

### Changed
- Prompt didattico: spiegare il perché, correggere indicando il punto dell'errore, dichiarare quando un risultato non è verificabile.
- Test di sicurezza: 17 check (default core/level, 403, full 200).

## v1.2.0 - 2026-10-19

### Added
- **Core mode** (`settings.mode`, default `core`): chat + GeoGebra + SymPy + conversations; quiz, review, KB, style, TTS and delegation are disabled (routes/tools/UI) until switching to **Completa** in Settings.

### Changed
- `/api/settings` and `/api/diagnostics` expose the mode; `/api/kb*`, `/api/review*`, `/api/profile`, `/api/quiz`, `/api/flashcards` return `403` in core; the AI tool list drops `delega`/`ricorda`.

## v1.1.0 - 2026-10-19

### Changed
- Refactor: `server.mjs` split into `lib/config.mjs`, `lib/models.mjs`, `lib/llm.mjs` and `lib/log.mjs`; one client for OpenCode/OpenRouter. Behavior unchanged; both provider paths verified with a real chat.
- `server.mjs` is ~1,640 lines (from ~1,930); the remaining split (SymPy, KB, conversations, backups) is documented in `docs/ARCHITECTURE.md`.

## v1.0.3 - 2026-10-19

### Added
- Preflight `start-mathapp.ps1 -Check` (Node/Python/SymPy/Whisper/port/key).
- `GET /api/diagnostics` and the Settings "Funzionalità" panel.
- README core/optional matrix, troubleshooting guide and architecture notes.

## v1.0.2 - 2026-10-19

### Fixed
- Body limit raised to 64 MB so four 8 MB attachments (base64) fit.
- The OpenRouter primary path is no longer logged as a fallback.

## v1.0.1 - 2026-10-19

### Added
- Settings drawer: provider (OpenRouter or OpenCode Go), API key, default model, dictation language, first-run banner.
- `GET/POST /api/settings` with a masked key (only the last 4 characters are shown).
- Security smoke test (`test_server_security.mjs`) and CI test job.

### Fixed
- Settings button/save could be covered by the GeoGebra layer (drawers now stack above the applet).
- Drawers/quick-click race: settings listeners are bound immediately, not after the model fetch.
- Mojibake in server prompts/messages (accents and punctuation restored).
- Static file path boundary, request bodies limited to 12 MB, cross-origin POST/DELETE rejected, atomic `settings.json` writes, friendly port-in-use error, uncaught errors logged.

### Changed
- Auth/model paths are portable (`MATHAPP_AUTH_FILE`, `MATHAPP_MODELS_JSON`, `MATHAPP_PORT`, `MATHAPP_NO_WHISPER`).
- Launcher uses the script folder and honours `MATHAPP_PORT`; README documents the API key setup and quick tests.
