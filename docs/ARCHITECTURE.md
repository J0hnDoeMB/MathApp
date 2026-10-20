# Architecture and maintenance notes

## Core vs optional

MathApp is intentionally **Node-only at its core**:

- `server.mjs` (HTTP, routes, chat orchestration) + `public/` (UI) + `lib/` (small shared parsers) run with Node and no npm dependencies.
- `sympy_cli.py` (Python + SymPy) adds exact algebra; `transcribe.py` (Python + faster-whisper) adds dictation.
- GeoGebra/KaTeX are loaded from CDNs by the browser. Without internet the rest of the app keeps working.

This boundary is the main answer to setup fragility: a missing optional dependency must never block chat, GeoGebra or saved conversations. `/api/diagnostics` exposes the detected capabilities; the launcher and the Settings drawer show them.

## Current shape

`server.mjs` is now ~1,640 lines (from ~1,930). The stable parts have been extracted without behavior changes:

- `lib/config.mjs` - paths, settings file (atomic writes), provider/key resolution, optional-dependency detection.
- `lib/models.mjs` - model catalog, capabilities, OpenRouter mapping and specialists.
- `lib/llm.mjs` - one client for OpenCode/OpenRouter (streaming, non-streaming, vision), retries and fallbacks.
- `lib/log.mjs` - bounded error log.

Still in `server.mjs`: HTTP routes, chat orchestration/tool schemas, SymPy bridge, knowledge base, conversations/reviews and backups.

## Planned split (incremental, no behavior change)

1. ~~`lib/config.mjs` - runtime paths, settings file (atomic writes), provider/key resolution, capability detection.~~
2. ~~`lib/models.mjs` + `lib/log.mjs` - catalog/capabilities and logging.~~
3. ~~`lib/llm.mjs` - one OpenAI-compatible client (OpenRouter/OpenCode endpoints, model mapping, retries, timeouts, streaming, vision).~~
4. Next: `lib/sympy-tools.mjs`, `lib/kb.mjs`, `lib/conversations.mjs`, `lib/backup.mjs`.
5. `server.mjs` - routes, chat orchestration and startup only.

Each step is a mechanical extraction verified by `npm test`, the server/security suite and `test_server_cancel.mjs`; the browser tests remain manual.

## Feature flags / lite mode

Implemented as `settings.mode` (`core` by default, `full` on request from Settings):

- **core**: chat + GeoGebra + SymPy + conversations + settings + backups. Adds no quiz/review/KB/style/TTS/delegation routes or tools.
- **full**: adds quiz, review, KB, style/profile, TTS buttons and the `delega`/`ricorda` tools.

The server rejects disabled endpoints with `403` and filters the tool list; the UI hides the related buttons. `mode` is persisted in `settings.json` and exposed by `/api/settings` and `/api/diagnostics`.

`settings.level` selects the detail level (`auto`, `breve`, `dettagliato`, `approfondito`) and is appended to the system prompt. The chat stream emits a `verification` event with the number of SymPy/GeoGebra tool calls, shown as a per-answer badge.

## Provider abstraction

The fragile part is external I/O: keys, model names, quotas. The target is a single client with:

- configurable base URL/key/model (OpenRouter by default, OpenCode Go as an option);
- request timeout + retry on 429/5xx, clear 401/403 messages;
- one streaming parser and one non-streaming call path;
- capability detection from a local catalog when available, safe fallbacks otherwise.

## Testing

- `npm test`: parsers + security smoke (CSRF, body limit, traversal, settings API).
- `npm run test:py`: 29 SymPy parser/tool tests.
- `node test_server_cancel.mjs`: cancellation and state revisions.
- Browser/UI tests need Puppeteer (`npm i -D puppeteer` or `MATHAPP_PUPPETEER`) and a running app.
- CI runs Node tests and the Python suite on Windows.
