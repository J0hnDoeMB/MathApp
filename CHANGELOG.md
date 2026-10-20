# Changelog

## v1.21.0 - 2026-10-20

### Added
- Prompt version (`PROMPT_VERSION`) exposed by diagnostics and chat traces.
- Deterministic math eval suite: `eval/math-cases.json` + `eval/run-eval.mjs` (17 cases), run by `npm run eval` and CI.
- `docs/SECURITY-MODEL.md`, `docs/PERFORMANCE.md`, `docs/SCORECARD.md`, `docs/KNOWN-LIMITATIONS.md`, ADR 0001/0002.

### Tests
- `npm test`: 79 checks; UI 15; GeoGebra 5; Python 29; math eval 17 cases.

## v1.20.0 - 2026-10-20

### Added
- Provider fallback test: OpenCode 401 -> OpenRouter with mocked fetch.
- Session corruption test: corrupt JSON quarantined, read null, list skips it.
- `npm test` now covers these critical failure paths.

### Tests
- `npm test`: **79 checks** (22 module + 4 agent + 4 chat-service + 3 observability + 2 provider fallback + 4 session recovery + 40 security/session); UI 15; GeoGebra 5; Python 29.

## v1.19.0 - 2026-10-20

### Added
- Structured observability: JSONL trace in `logs/trace.jsonl` (rotation 2 MB), request IDs (`X-Request-Id`), chat and tool operation IDs/durations.
- `GET /api/traces` for last events; no prompt/keys/user content stored.
- `docs/OBSERVABILITY.md`.

### Tests
- `npm test`: **73 checks** (22 module + 4 agent + 4 chat-service + 3 observability + 40 security/session); UI 15; GeoGebra 5; Python 29.

## v1.18.0 - 2026-10-20

### Added
- Explicit adapter ports (`lib/ports.mjs`, `lib/adapters.mjs`) for LLM, math, graph, audio and documents.
- Capabilities model (`lib/capabilities.mjs`) with required/optional status and fallback; exposed by `/api/diagnostics` and `/api/health`.
- `docs/CAPABILITIES.md` (degraded mode matrix).

### Tests
- `npm test`: **68 checks** (22 module + 4 agent + 4 chat-service + 38 security/session); UI 15; GeoGebra 5; Python 29.

## v1.17.0 - 2026-10-20

### Added
- `lib/json-store.mjs`: atomic JSON writes (temp + rename) and quarantine of corrupt files.
- Session, review, profile and KB repositories now use the shared JSON store.
- `docs/PERSISTENCE.md` documents the storage contract and corruption policy.

### Tests
- `npm test`: **65 checks** (20 module + 4 agent + 4 chat-service + 37 security/session); UI 15; GeoGebra 5; Python 29.

## v1.16.0 - 2026-10-20

### Added
- Central diagnostics (`lib/diagnostics.mjs`, `GET /api/diagnostics|/api/health`): Node, Python/SymPy/Whisper, provider/key, data dir, backup dir, port, mode/level.
- `start-mathapp.ps1 -Check` now verifies data/ and backups/ writability and shows mode/level.
- `docs/QUALITY-GATE.md`: core vs extra, feature freeze and definition of done.

### Tests
- `npm test`: **64 checks** (19 module + 4 agent + 4 chat-service + 37 security/session); UI 15; GeoGebra 5; Python 29.

## v1.15.0 - 2026-10-20

### Added
- Client command bus: `MathAppState.handle(name, fn)` and `dispatch(name, payload)`; flows `session.new`, `chat.send` and `session.restore` now go through the application boundary.
- UI smoke checks the registered commands.

### Tests
- `npm test`: 62 checks; UI smoke: **15 checks**; GeoGebra: 5.

## v1.14.0 - 2026-10-20

### Changed
- Style/profile UI moved to `public/features/style.js`; core loads no style code.
- Plugin loader now covers quiz/review/tts/kb/style; `app.js` down to ~2,640 lines.

### Tests
- `npm test`: 62 checks; UI smoke: **14 checks** (style drawer included); GeoGebra: 5.

## v1.13.0 - 2026-10-20

### Changed
- Review, TTS and KB UI moved to lazy plugins (`public/features/review.js`, `tts.js`, `kb.js`); core mode loads none of them.
- Plugin loader returns each plugin API; review/TTS/KB expose refresh/add/speak/stop as appropriate.
- `app.js` dropped to ~2,680 lines; quiz/review/TTS/KB are no longer in the core bundle.

### Tests
- `npm test`: 62 checks; UI smoke: **13 checks** (core no-load, full load + drawers); GeoGebra: 5.

## v1.12.0 - 2026-10-20

### Added
- Client feature plugin loader (`public/features.js`) and lazy quiz UI (`public/features/quiz.js`). The quiz script is loaded only in full mode; core mode never requests it.
- Plugin contract: `MathAppPlugins.register(id, init)`, init receives `MathAppApp` (`, `flash`, `refreshReviewBadge`, state).

### Tests
- `npm test`: 62 checks; UI smoke: **11 checks** (including core no-load and full load); GeoGebra: 5.

## v1.11.0 - 2026-10-20

### Added
- Optional route plugins loaded on demand: `prepareApi` loads kb/profile/review/study only when mode is full; core routes remain static.
- Plugin contract: each optional route exports `feature` and `handle`; the loader validates id and reports load failures without crashing.

### Tests
- `npm test`: **62 checks** (19 module + 4 agent + 4 chat-service + 35 security/session); UI 8; GeoGebra 5.

## v1.10.0 - 2026-10-20

### Changed
- Client state migration completed: `app.js` uses `MathAppState.domain/ui` directly; compatibility global accessors were removed (UI smoke asserts they are absent).
- `public/state.js` is the single client state source, with events and snapshot.

### Tests
- `npm test`: 61 checks; UI smoke: 8; GeoGebra: 5.

## v1.9.0 - 2026-10-20

### Changed
- Client state boundary: `public/state.js` now owns domain state (session, messages, cells, view, figures) and UI state (drawers/activity flags) with `on/emit/snapshot`.
- `public/app.js` uses compatibility accessors for the existing globals; the single source of truth is `MathAppState`.
- Browser smoke asserts the store exists and the domain conversation id is available.

### Tests
- `npm test`: 61 checks; UI smoke: **8 checks**; GeoGebra: 5.

## v1.8.0 - 2026-10-20

### Changed
- Chat flow extracted from `routes/chat.mjs` into `lib/chat-service.mjs` (vision fallback, attachments, KB, agent, session save); route is now HTTP/SSE only.
- CSRF/body-cap guard extracted into `lib/security.mjs`; `server.mjs` is a ~42-line shell.
- Chat orchestrator test with fake dependencies; no network.

### Tests
- `npm test`: **61 checks** (18 module + 4 agent + 4 chat-service + 35 security/session).
- UI 7, GeoGebra 5, Python 29.

## v1.7.0 - 2026-10-20

### Changed
- Session persistence centralized in `lib/session-store.mjs`: read/write, state merge, revision guard, history search, tags and delete no longer touch the filesystem in routes.
- `lib/schema.mjs` validates state inputs and migrates stored sessions (`schemaVersion: 1`); limits for ggb, cells, figures, tags.
- `docs/DATA-MODEL.md` and `docs/CONTRACTS.md` define entities, versions, ports and layer boundaries.

### Tests
- `npm test`: **57 checks** (18 module + 4 agent + 35 security/session), including schema/migration and invalid state.
- UI 7, GeoGebra 5, Python 29.

## v1.6.0 - 2026-10-20

### Changed
- Phase 2 feature modules: routes split into `backup`, `kb`, `profile`, `review`, `study`, `compute`; SM-2 in `lib/review.mjs`, flashcard/quiz prompts and generation in `lib/study.mjs`, optional-API gate in `lib/features.mjs`.
- No new UI features: only isolation, contracts and tests for existing didactic features.

### Tests
- `npm test`: **52 checks** (15 module + 4 agent + 33 security/session, including core/full isolation).
- `npm run test:ui` (7), `npm run test:geo` (5), Python (29).

## v1.5.4 - 2026-10-20

### Added
- `test_geogebra_smoke.mjs`: crea una costruzione, la serializza, salva lo stato via API, ricarica e verifica il rebuild dell'applet GeoGebra (5 check, in CI).

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
