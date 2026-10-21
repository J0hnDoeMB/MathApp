# Product scorecard

Current state (v1.25.0):

| Metric | Current |
|---|---|
| Build/CI | Windows + Linux core matrix, branch protected |
| Node checks | 80 |
| UI smoke | 16 |
| GeoGebra smoke | 5 |
| Python tests | 29 |
| Portable CI | Node 18 / 20 / 22 on Linux + browser smoke |
| Coverage | c8, 40% line gate |
| Real-provider eval | optional, key-gated |
| Math eval cases | 17 |
| Critical vulnerabilities | none known; no runtime npm deps |
| Core domains | chat, session, math, docs, audio, AI providers |
| Data persistence | versioned, atomic, corruption-quarantined |
| Diagnostics | `/api/diagnostics`, `/api/health`, `start -Check` |
| Observability | request/tool IDs, JSONL trace, 2 MB rotation |
| Provider fallbacks | OpenCode -> OpenRouter tested |
| Core vs optional | core/full gate + lazy UI plugins |
| Documentation | architecture, contracts, data model, persistence, capabilities, security, observability, runbook |

Not yet measured automatically: exact first-token latency, full browser flow coverage and real-provider AI answer quality (the optional `eval:ai` harness needs a key and human review). Those are the next quality metrics, not feature work.
