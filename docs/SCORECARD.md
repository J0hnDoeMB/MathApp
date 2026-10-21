# Product scorecard

Current state (v1.29.0):

| Metric | Current |
|---|---|
| Build/CI | Windows + Linux core matrix, branch protected |
| Node checks | 120 |
| UI smoke | 25 |
| XSS browser checks | 14 |
| Conversation-switch checks | 1 |
| GeoGebra smoke | 5 |
| Python tests | 29 |
| Portable CI | Node 18 / 20 / 22 on Linux + browser smoke |
| Coverage | c8, 65% line gate (71.1% measured) |
| Real-provider eval | 5/5 (deepseek-v4-flash, 2026-10-21; optional, key-gated) |
| Math eval cases | 17 |
| Critical vulnerabilities | none known; no runtime npm deps |
| Core domains | chat, session, math, docs, audio, AI providers |
| Data persistence | versioned, atomic, corruption-quarantined |
| Single instance | PID lock per data dir with stale-owner recovery |
| Release artifact | versioned source zip + tag-driven GitHub workflow |
| Accessibility | skip link, visible focus, mobile 390 px smoke |
| Diagnostics | `/api/diagnostics`, `/api/health`, `start -Check`, app version |
| Observability | request/tool IDs, JSONL trace, first-token timing, 2 MB rotation |
| Provider fallbacks | OpenCode -> OpenRouter tested |
| Core vs optional | core/full gate + lazy UI plugins |
| Documentation | architecture, contracts, data model, persistence, capabilities, security, observability, runbook, release |

Not yet measured automatically: full browser flow coverage and real-provider AI answer quality (the optional `eval:ai` harness needs a key and human review). Chat first-token latency is traced (`chat.first_token`) but is not yet a performance gate.
