# Contracts

Contratti tra i boundary. Le implementazioni possono cambiare (OpenRouter, OpenCode, SymPy, Edge) senza cambiare i chiamanti.

## Layers

| Layer | Dove | Responsabilità |
|---|---|---|
| Presentation | `public/` | UI, pannelli, stato client, eventi utente |
| Application | `routes/`, `lib/chat-service.mjs`, `lib/agent.mjs` | orchestrazione richieste, chat flow, tool loop |
| Domain | `lib/session-store`, `review`, `study`, `kb`, `profile`, `levels`, `features` | regole del prodotto |
| Integration | `lib/llm`, `sympy`, `geogebra`, `audio`, `documents` | adapter verso servizi esterni |
| Infrastructure | `lib/storage`, `config`, `schema`, `log`, `http`, `security` | filesystem, JSON, impostazioni, guardie HTTP |

`server.mjs` compone: sicurezza → `routes/` → statici.

## Ports

### AIProvider
```text
stream({ sessionId, payload }, send, signal) -> { content, toolCalls, usage }
generate(messages, { maxTokens, signal }) -> { text, usage }
cancel(sessionId) -> void
```
Adapter: `lib/llm.mjs` (OpenRouter/OpenCode, fallback). Gli errori di provider espongono messaggio leggibile; il chiamante decide il fallback.

### MathEngine
```text
compute(args) -> { ok, result, latex?, error? }
```
Adapter: `lib/sympy.mjs`. Non lancia per errori di calcolo; timeout, output cap e concorrenza sono responsabilità dell'adapter.

### GraphEngine
```text
run(send, commands, title, mode, convId, view, signal) -> Promise<result>
edit(send, ops, signal) -> Promise<result>
resolve(callId, results) -> void
```
Adapter: `lib/geogebra.mjs`. Un timeout del browser non blocca la chat: restituisce una nota.

### AudioTranscriber
```text
transcribe(b64) -> { ok, text, language, duration, model, error? }
```
Adapter: `lib/audio.mjs` (worker Whisper persistente, cache).

### DocumentParser
```text
extractText(name, mime, b64) -> { ok, text, error? }
```
Adapter: `lib/documents.mjs` (PDF/testo).

### SessionRepository
```text
read(id) -> Session|null
applyState(rawState) -> { ok, stale?, error? }
list() -> SessionSummary[]
history(query) -> SessionSummary[]
delete(id) -> void
updateTags(id, tag, action) -> { status, ok, tags?, error? }
```
Implementazione: `lib/session-store.mjs`; schema: `lib/schema.mjs`.

### ClientFeaturePlugin
```text
MathAppPlugins.register("quiz", init) // also review, tts, kb, style
init(MathAppApp) // app = { $, flash, mkBtn, renderMD, fmtDate, openConv, b64FromBlob, refreshReviewBadge, state }
```
The loader injects `/features/<id>.js` only when needed; core mode never downloads optional UI.

### Adapter ports
```text
llm: { stream, generate, vision }
math: { compute }
graph: { run, edit, resolve }
audio: { transcribe }
documents: { extractText }
```
Implementation: `lib/adapters.mjs`, validated by `lib/ports.mjs`. The concrete integrations remain in `lib/llm/sympy/geogebra/audio/documents`.

### Capabilities
```text
capabilityReport() -> { ok, capabilities: { chat, provider, storage, math, documents, audio, geogebra, tts, fullFeatures } }
```
Implementation: `lib/capabilities.mjs`; exposed by diagnostics.

### JsonStore
```text
readJson(file, fallback) -> value
writeJsonAtomic(file, value) -> { ok, error? }
```
Implementation: `lib/json-store.mjs`. Repositories must use it; corrupt files are quarantined, missing files return the fallback.

### Diagnostics
```text
diagnostics(port) -> { ok, node, python, sympy, whisper, provider, hasKey, dataDirOk, backupDirOk, port, mode, level }
```
Implementation: `lib/diagnostics.mjs`; exposed by `/api/diagnostics` and `/api/health`, mirrored by `start-mathapp.ps1 -Check`.

### FeaturePlugin
```text
export const feature = "kb"
export function handle(req, res, url, ctx) -> boolean
```
Optional modules are loaded only in full mode by `routes/index.mjs`; a load failure returns `500` and does not crash the server.

### ClientState
```text
MathAppState.domain / MathAppState.ui
on(event, fn) / emit(event, value) / snapshot()
```

### ClientCommandBus
```text
MathAppState.handle(name, fn)
MathAppState.dispatch(name, payload) -> Promise
```
Commands: `session.new`, `chat.send`, `session.restore`. UI events call dispatch; application handlers mutate state.
Implementation: `public/state.js`. `app.js` uses `MathAppState` directly; no legacy global state.

### ChatOrchestrator
```text
executeChat({ body, send, isGone, signal, deps? }) -> { cancelled, finalText, convId, usedModel }
```
Implementation: `lib/chat-service.mjs`. `deps` is a test seam; the route owns HTTP/SSE only.

### RequestGuard
```text
guardRequest(req, res) -> boolean
```
Implementation: `lib/security.mjs` (CSRF + body cap).

### StorageService
```text
dataDir, convDir, backups
runBackup() -> { ok, file?, size?, error? }
```
Implementazione: `lib/storage.mjs`.

## Regole di errore

- Un adapter restituisce `{ok:false,error}` per errori previsti; lancia solo per cancellazione/abort.
- Un provider o un PDF rotto non deve impedire chat, sessione o grafo.
- Gli endpoint opzionali sono protetti da `lib/features.mjs` (core/full).
- Nessun modulo domain/integration importa `server.mjs` o `public/`.
- La UI non parla direttamente con filesystem o provider: usa le route.

## Gap noti

- Lo stato UI/domain è in `public/state.js`, ma `app.js` è ancora un classico script: l'event model UI → application è il prossimo lavoro del layer Presentation.
- I plugin backend sono caricati on-demand; il codice UI delle feature opzionali è ancora nel bundle unico di `app.js`.
