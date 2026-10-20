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
| XSS from model Markdown | HTML whitelist, raw HTML/script/handlers removed | `test_xss.mjs` |
| XSS in project/session names | `esc`/`jarg` escaping in UI | security smoke/manual |
| SymPy code execution | AST whitelist parser; no eval/sympify on user input | `test_sympy_cli` |
| Model output executed as code | GeoGebra commands parsed/validated; no eval | unit/manual |
| Prompt injection via attachments | extracted content is data, not instructions; tool/route boundaries | review |
| Provider key leakage | local file only, redacted logs/traces | tests/docs |
| Upload abuse | size/type caps, files confined to `data/kb` | security smoke |
| Corrupt JSON | atomic write + quarantine | `test_session_corrupt` |
| Rate-limit lockout | only explicit wrong credentials count | security smoke |
| Dependency failure | capabilities/fallback, no crash | diagnostics/tests |

## Rules

1. Treat all user/model/document input as hostile.
2. No raw HTML from Markdown.
3. No external URL fetched from inside a model tool without an explicit adapter.
4. No secret in UI state, trace, logs, backups or repository.
5. A security-sensitive change requires a test and an update to this document.
