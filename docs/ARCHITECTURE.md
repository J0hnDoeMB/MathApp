# Architecture and maintenance notes

## Core vs optional

MathApp is intentionally **Node-only at its core**:

- `server.mjs` (HTTP/routes) + `public/` (UI) + `lib/` run with Node and no npm runtime dependencies.
- `sympy_cli.py` (Python + SymPy) adds exact algebra; `transcribe.py` (Python + faster-whisper) adds dictation.
- GeoGebra/KaTeX are loaded from CDNs by the browser. Without internet the rest of the app keeps working.

A missing optional dependency must never block chat, GeoGebra or saved conversations. `/api/diagnostics` exposes detected capabilities; the launcher and Settings show them.

## Module map (v1.5.0)

`server.mjs` is the HTTP shell (security, router, static, startup). API route groups live in `routes/`; domain services live in `lib/`. Neither routes nor services import `server.mjs`.

| Module | Responsibility | Depends on |
|---|---|---|
| `server.mjs` | security, router, static files, startup | routes |
| `routes/*.mjs` | API groups: settings, library, conversations, chat | lib services |
| `lib/config.mjs` | settings file, paths, provider/key resolution, capability detection | Node only |
| `lib/models.mjs` | model catalog, OpenRouter mapping, specialists | config |
| `lib/llm.mjs` | one OpenAI-compatible client (streaming/non-streaming/vision) | config, models, log |
| `lib/levels.mjs` | detail levels (`auto`, `breve`, `dettagliato`, `approfondito`) | none |
| `lib/prompts.mjs` | system prompt, LaTeX/didactic rules, level rule | levels |
| `lib/tools.mjs` | tool schemas and core/full filtering | none |
| `lib/agent.mjs` | agent loop, escalation, delegation, verification counts | llm, tools, prompts, sympy, geogebra, profile |
| `lib/sympy.mjs` | exact math child process, timeout/output/concurrency limits | util |
| `lib/geogebra.mjs` | GeoGebra bridge and browser confirmations | storage, log |
| `lib/documents.mjs` | PDF/text extraction and upstream message building | audio, util |
| `lib/audio.mjs` | persistent Whisper worker, audio cache, language changes | config, log, util |
| `lib/kb.mjs` | attachment index, chunks and BM25-lite search | storage, log |
| `lib/profile.mjs` | style-memory CRUD and prompt selection | storage, log |
| `lib/storage.mjs` | conversations, review file, backups | config, log |
| `lib/util.mjs` | project paths, UTF-8 Python env, bounded caches | none |
| `public/` | browser UI (GeoGebra, chat, notebook) | HTTP API |

Dependency direction: `server -> agent -> tools/services -> storage/config`. Lower layers never import `server.mjs` or `public/`.

## Contracts and invariants

- `server.mjs` owns HTTP only: parsing, validation, status codes, SSE framing. Domain modules never import it.
- `runAgent(payload, sessionId, send, isGone, signal, deps?)` emits SSE events and returns the final text. `deps` is a test seam; production uses the real provider/tools.
- `runSympy`, `runGGB`, `audioToText`, `docToText` return structured results; adapter failures are reported as `{ok:false,error}` or tool errors, not process crashes.
- `storage` is the only module that knows `data/` paths; `MATHAPP_DATA_DIR` isolates tests.
- Core modules must not import optional feature modules. `agent` uses the tool registry, not UI or routes.
- A failing provider, PDF, audio file or GeoGebra command must not block chat/session persistence.

## What changed in the refactor

- `server.mjs` dropped from **~1,688 lines / 92 KB** to **~60 lines / 3 KB**.
- API routes are grouped in `routes/`; conversations/reviews/backups, KB, profile, SymPy, PDF/text, Whisper, GeoGebra, prompts/tools and the agent loop are separate `lib/` modules.
- Public HTTP behavior is unchanged: verified by the security suite and a real chat using SymPy.
- `test_modules.mjs` adds direct unit checks for levels, prompts, tools, KB tokenization/chunking, SM-2 normalization, cache bounds and audio types.

## Remaining risks / next steps

1. Browser smoke covers new chat, session restore and view state; a dedicated GeoGebra applet rebuild test remains manual.
2. External dependencies (AI providers, GeoGebra/KaTeX CDN, Whisper models) remain the main failure surface; keep capabilities explicit and fallbacks visible.
3. Windows/PowerShell setup is convenient but platform-specific; the Node server itself stays portable.
4. The full browser suite (XSS, conversation switch, GeoGebra applet) still runs manually; only the smoke subset is in CI.

## Feature flags / lite mode

`settings.mode` (`core` by default, `full` on request from Settings):

- **core**: chat + GeoGebra + SymPy + conversations + settings + backups. No quiz/review/KB/style/TTS/delegation routes or tools.
- **full**: adds quiz, review, KB, style/profile, TTS buttons and the `delega`/`ricorda` tools.

Disabled endpoints return `403`; the UI hides related buttons. `settings.level` selects the detail level and is appended to the system prompt. The chat stream emits a `verification` event with SymPy/GeoGebra tool-call counts, shown as a per-answer badge.

## Provider abstraction

External I/O is isolated in `lib/llm.mjs`:

- configurable base URL/key/model (OpenRouter, OpenCode Go);
- timeout/retry, clear 401/403 messages;
- one streaming parser and one non-streaming path;
- capability detection from a local catalog with safe fallbacks.

## Testing

- `npm test`: 42 checks (10 module + 4 agent + parsers + 28 security/session: CSRF, body limit, traversal, settings API, state persistence/revision, library routes).
- `npm run test:ui`: 7 browser smoke checks (new chat, session restore, view, UI); CI uses puppeteer-core + Edge.
- `npm run test:py`: 29 SymPy parser/tool tests.
- `node test_server_cancel.mjs`: cancellation and state revisions.
- Full browser tests need Puppeteer and a running app; `npm run test:ui` is the CI smoke subset.
- CI runs Node tests, browser smoke and the Python suite on Windows.
