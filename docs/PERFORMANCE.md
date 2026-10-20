# Performance budgets

These are product budgets, not micro-benchmarks.

| Area | Budget | How to check |
|---|---|---|
| App startup | < 3 s on a normal PC | `start-mathapp.ps1` / browser smoke |
| Session restore | < 1 s excluding GeoGebra CDN | UI smoke state restore |
| Exact math common case | < 2 s | `npm run eval` / diagnostics |
| Chat first token | provider-dependent | trace `http`/`op` durations |
| UI under long work | no blocking; Stop available | manual/UI tests |
| API status warm | < 100 ms | `/api/diagnostics` cached |
| Trace overhead | negligible (< 1 ms/request) | local measurement |

## Where to measure

- `logs/trace.jsonl`: `http.ms`, `op.end.ms` for chat/tools.
- `GET /api/traces?limit=50`.
- `npm run test:ui` measures load/restore flow.
- `npm run eval` measures SymPy cases.

Budgets are intentionally generous for a local app; they are guardrails against blocking the UI or silent multi-second operations.
