# Product scorecard

Current state (v1.21.0):

| Metric | Current |
|---|---|
| Build/CI | green, branch protected |
| Node checks | 79 |
| UI smoke | 16 |
| GeoGebra smoke | 5 |
| Python tests | 29 |
| Math eval cases | 17 |
| Critical vulnerabilities | none known; no runtime npm deps |
| Core domains | chat, session, math, docs, audio, AI providers |
| Data persistence | versioned, atomic, corruption-quarantined |
| Diagnostics | `/api/diagnostics`, `/api/health`, `start -Check` |
| Observability | request/tool IDs, JSONL trace, 2 MB rotation |
| Provider fallbacks | OpenCode -> OpenRouter tested |
| Core vs optional | core/full gate + lazy UI plugins |
| Documentation | architecture, contracts, data model, persistence, capabilities, security, observability, runbook |

Not yet measured automatically: line coverage, exact first-token latency, full browser flow coverage, real-provider AI answer quality. Those are the next quality metrics, not feature work.
