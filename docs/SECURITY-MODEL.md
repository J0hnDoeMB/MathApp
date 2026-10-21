# Security model

## Boundary

- Server bound to **127.0.0.1**.
- No authentication is built into MathApp: it is a local single-user app. If exposed, put it behind an authenticated reverse proxy/VPN.
- API key stays in `settings.json`, is never returned by the API, never logged and not included in backups.

## Threats and controls

| Threat | Control | Test |
|---|---|---|
| CSRF from another site | Origin/Sec-Fetch-Site checks on every non-GET | security smoke |
| Oversized body | 64 MB cap, early 413 | security smoke |
| Path traversal (static/files) | resolved path must stay under the allowlisted root | security smoke |
| XSS from model Markdown | HTML whitelist, raw HTML/script/handlers removed | `test/test_xss.mjs` |
| XSS from user content | text/DOM construction, escaping at render boundaries | `test/test_xss.mjs` |
| SymPy code execution | AST whitelist parser; no eval/sympify on user input | `test_sympy_cli` |
| Model output executed as code | GeoGebra commands parsed/validated; no eval | unit/manual |
| Prompt injection via attachments | extracted content is data, not instructions; tool/route boundaries | review |
| Provider key leakage | local file only, redacted logs/traces; POSIX `0600` | tests/docs |
| Upload abuse | size/type allowlist, files confined to `data/kb`, HTML/SVG served as attachments | `test_hardening` |
| Stored XSS via KB upload | server-side MIME allowlist + `nosniff`; active content never inline | `test_hardening` |
| CDN supply chain | fixed versions + Subresource Integrity; GeoGebra codebase pinned | `test_hardening` |
| Missing browser hardening | CSP, `nosniff`, `DENY`, no-referrer, Permissions-Policy | `test_hardening` |
| Hung upstream / PDF extraction | bounded fetch and PDF timeouts; stream idle watchdog | `test_hardening` |
| Disk full / unwritable data | explicit save-failure notice; no silent success | `test_chat_service` |
| Local data readable by other users | POSIX `0600` files and `0700` directories | `test_hardening` (Linux CI) |
| Corrupt JSON | atomic write + quarantine | `test_session_corrupt` |
| Two instances on the same data dir | PID lock; stale lock recovered only when the PID is gone | `test_instance_lock` |
| Rate-limit lockout | only explicit wrong credentials count | security smoke |
| Dependency failure | capabilities/fallback, no crash | diagnostics/tests |

## Rules

1. Treat all user/model/document input as hostile.
2. No raw HTML from Markdown.
3. No external URL fetched from inside a model tool without an explicit adapter.
4. No secret in UI state, trace, logs, backups or repository.
5. A security-sensitive change requires a test and an update to this document.
