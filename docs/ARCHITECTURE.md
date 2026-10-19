# Architecture and maintenance notes

## Core vs optional

MathApp is intentionally **Node-only at its core**:

- `server.mjs` (HTTP, routes, chat orchestration) + `public/` (UI) + `lib/` (small shared parsers) run with Node and no npm dependencies.
- `sympy_cli.py` (Python + SymPy) adds exact algebra; `transcribe.py` (Python + faster-whisper) adds dictation.
- GeoGebra/KaTeX are loaded from CDNs by the browser. Without internet the rest of the app keeps working.

This boundary is the main answer to setup fragility: a missing optional dependency must never block chat, GeoGebra or saved conversations. `/api/diagnostics` exposes the detected capabilities; the launcher and the Settings drawer show them.

## Current shape

`server.mjs` is still a monolith (~1,900 lines): HTTP routes, provider client, chat orchestration, SymPy/GeoGebra tools, knowledge base, reviews and backups live together. It is covered by server/security and Python tests, but the file is the main maintenance risk.

## Planned split (incremental, no behavior change)

1. `lib/config.mjs` - runtime paths, settings file (atomic writes), provider/key resolution, capability detection.
2. `lib/llm.mjs` - one OpenAI-compatible client (OpenRouter/OpenCode endpoints, model mapping, retries, timeouts, streaming, vision). Removes the duplicated HTTP paths.
3. `lib/sympy-tools.mjs` - Python bridge, timeouts/concurrency limits, tool schemas.
4. `lib/kb.mjs`, `lib/reviews.mjs`, `lib/conversations.mjs`, `lib/backup.mjs` - storage and domain logic.
5. `server.mjs` - routes, chat orchestration and startup only.

Each step is a mechanical extraction verified by `npm test`, the server/security suite and `test_server_cancel.mjs`; the browser tests remain manual.

## Feature flags / lite mode

The public app currently ships the full feature set. If the goal is a smaller public surface, add `settings.features` (default `core`):

```json
{ "features": { "sympy": true, "whisper": true, "quiz": true, "review": true, "kb": true, "tts": true, "delegation": true, "vision": true } }
```

Server endpoints and UI buttons check the flags; `core` enables chat + GeoGebra + conversations only. Advanced features stay available in the full build. This reduces the bug surface without maintaining two codebases.

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
