# Architecture and maintenance notes

## Core vs optional

MathApp is intentionally **Node-only at its core**:

- `server.mjs` (HTTP/routes) + `public/` (UI) + `lib/` run with Node and no npm runtime dependencies.
- `sympy_cli.py` (Python + SymPy) adds exact algebra; `transcribe.py` (Python + faster-whisper) adds dictation.
- GeoGebra/KaTeX are loaded from CDNs on the first visit; `public/sw.js` caches the shell and CDN assets so later visits can work offline. A brand-new install still needs internet once for the CDN assets.

A missing optional dependency must never block chat, GeoGebra or saved conversations. `/api/diagnostics` exposes detected capabilities; the launcher and Settings show them.

## Module map (v1.29.0)

`server.mjs` is the HTTP shell (security, router, static, startup). API route groups live in `routes/`; domain services live in `lib/`. Neither routes nor services import `server.mjs`.

| Module | Responsibility | Depends on |
|---|---|---|
| `server.mjs` | security, router, static files, startup, instance lock | routes, instance-lock |
| `routes/*.mjs` | core API groups + optional plugins (kb/profile/review/study) loaded on demand | lib services |
| `lib/config.mjs` | settings file, paths, provider/key resolution, capability detection | Node only |
| `lib/models.mjs` | model catalog, OpenRouter mapping, specialists | config |
| `lib/llm.mjs` | one OpenAI-compatible client (streaming/non-streaming/vision) | config, models, log |
| `lib/levels.mjs` | detail levels (`auto`, `breve`, `dettagliato`, `approfondito`) | none |
| `lib/prompts.mjs` | system prompt, LaTeX/didactic rules, level rule | levels |
| `lib/tools.mjs` | tool schemas and core/full filtering | none |
| `lib/agent.mjs` | agent loop, escalation, delegation, verification counts | llm, tools, prompts, sympy, geogebra, profile |
| `lib/chat-service.mjs` | chat orchestration: vision, attachments, KB, agent, save | models, llm, documents, kb, agent, session-store |
| `lib/security.mjs` | CSRF and body-cap request guard | config |
| `lib/instance-lock.mjs` | single-instance guard per data directory, stale-PID recovery | storage |
| `routes/index.mjs` | core route dispatch + lazy plugin loader | routes, features |
| `lib/sympy.mjs` | exact math child process, timeout/output/concurrency limits | util |
| `lib/geogebra.mjs` | GeoGebra bridge and browser confirmations | session-store, log |
| `lib/documents.mjs` | PDF/text extraction and upstream message building | audio, util |
| `lib/audio.mjs` | persistent Whisper worker, audio cache, language changes | config, log, util |
| `lib/kb.mjs` | attachment index, chunks and BM25-lite search | storage, log |
| `lib/profile.mjs` | style-memory CRUD and prompt selection | storage, log |
| `lib/review.mjs` | SM-2 scheduling | storage |
| `lib/study.mjs` | flashcard/quiz prompts, model call and parsing | llm, parsers |
| `lib/features.mjs` | optional API gate + plugin registry (id, prefixes, module) | none |
| `lib/session-store.mjs` | session repository: read/write, state merge, history, tags | storage, schema, models, log |
| `lib/schema.mjs` | data validation, limits and migrations | none |
| `lib/ports.mjs`, `lib/adapters.mjs` | external port contracts and concrete adapter container | integration services |
| `lib/capabilities.mjs` | required/optional capability status and degraded fallback | config, storage, fs-check |
| `lib/diagnostics.mjs` | runtime/storage/provider diagnostics for API and launcher | config, storage, levels, capabilities |
| `lib/observability.mjs` | request/operation IDs, JSONL trace, rotation | config |
| `lib/json-store.mjs` | atomic JSON read/write, corruption quarantine | log |
| `lib/storage.mjs` | data paths, review file, backups | config, log, json-store |
| `lib/util.mjs` | project paths, UTF-8 Python env, bounded caches | none |
| `public/state.js` | client domain/UI store, command bus and events | browser only |
| `public/core/format.js`, `public/core/markdown.js` | formatting helpers and safe Markdown/KaTeX rendering | browser only |
| `public/core/sources.js`, `public/core/export.js` | note-source matching and PDF/Markdown export | browser only |
| `public/sw.js` | offline shell and CDN asset cache (GET only; never `/api`) | browser only |
| `public/features.js`, `public/features/*.js` | lazy optional UI plugins (quiz, review, TTS, KB, style) | `MathAppApp` API |
| `public/` | browser UI (GeoGebra, chat, notebook) | HTTP API |

Dependency direction: `server -> routes/agent -> domain/integration -> infrastructure`. Lower layers never import `server.mjs` or `public/`. Data entities and limits are in [`DATA-MODEL.md`](DATA-MODEL.md); ports and layer map in [`CONTRACTS.md`](CONTRACTS.md).

## Contracts and invariants

- `server.mjs` owns HTTP only: parsing, validation, status codes, SSE framing. Domain modules never import it.
- `runAgent(payload, sessionId, send, isGone, signal, deps?)` emits SSE events and returns the final text. `deps` is a test seam; production uses the real provider/tools.
- `runSympy`, `runGGB`, `audioToText`, `docToText` return structured results; adapter failures are reported as `{ok:false,error}` or tool errors, not process crashes.
- `storage` is the only module that knows `data/` paths; `MATHAPP_DATA_DIR` isolates tests.
- Core modules must not import optional feature modules. `agent` uses the tool registry, not UI or routes.
- A failing provider, PDF, audio file or GeoGebra command must not block chat/session persistence.

## What changed in the refactor

- `server.mjs` dropped from **~1,688 lines / 92 KB** to **~93 lines / 5 KB** including startup and the instance lock.
- API routes are grouped in `routes/`; conversations/reviews/backups, KB, profile, review, study, SymPy, PDF/text, Whisper, GeoGebra, prompts/tools and the agent loop are separate `lib/` modules.
- Public HTTP behavior is unchanged: verified by the security suite and a real chat using SymPy.
- `test/test_modules.mjs` adds direct unit checks for levels, prompts, tools, KB tokenization/chunking, SM-2 normalization, cache bounds and audio types.

## Remaining risks / next steps

1. Browser smoke covers new chat/session/view; `test/test_geogebra_smoke.mjs` covers the GeoGebra applet rebuild in CI.
2. External dependencies (AI providers, GeoGebra/KaTeX CDN, Whisper models) remain the main failure surface; keep capabilities explicit and fallbacks visible.
3. Windows/PowerShell setup is convenient but platform-specific; the Node server itself stays portable.
4. XSS, layout/mobile, conversation switching and 3D remain partly manual; XSS and the mobile smoke are now in CI.

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

- `npm run eval`: 17 deterministic SymPy cases (`eval/`).
- `npm test`: 88 checks (23 module + 4 agent + 5 chat-service + 3 observability + 2 provider fallback + 4 session recovery + 41 security/session + 6 instance lock + parser).
- `npm run test:ui`: 24 browser smoke checks (UI, service-worker offline shell, skip link, mobile 390 px overflow/composer, state store, command bus, settings open, lazy plugins core/full, drawers, new chat, session restore, view); CI uses puppeteer-core with Edge/Chrome; Linux uses headless Chrome.
- `npm run test:xss`: 14 self-contained browser checks (Markdown, tools, LaTeX) with a temporary server, in CI.
- `npm run test:geo`: 5 GeoGebra checks (build, base64, state save, reload rebuild).
- `npm run test:py`: 29 SymPy parser/tool tests.
- `node test/test_server_cancel.mjs`: cancellation and state revisions.
- `npm run test:ui`, `npm run test:xss` and `npm run test:switch` are self-contained; they start a temporary server and use puppeteer-core.
- CI runs Node tests, browser smoke, XSS regression, conversation-switch regression and the Python suite on Windows.
