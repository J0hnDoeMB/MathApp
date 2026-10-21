# Security Policy

MathApp runs locally on a single user's machine. It does not include a hosted service, accounts, or telemetry.

## Supported versions

Security fixes target the latest release on `main` (currently `1.24.x`). Older tags are kept for reference but are not actively patched.

## Reporting a vulnerability

Please **do not open a public issue** for a security problem.

Use GitHub's private vulnerability reporting:

1. Open the repository's **Security** tab.
2. Choose **Advisories** / **Report a vulnerability**.
3. Include steps to reproduce, affected version/commit and the impact you observed.

You can expect an acknowledgement within a few days. Please allow time for a fix before public disclosure.

## Scope

In scope:

- Authentication/authorization on the local HTTP server.
- CSRF, path traversal, XSS, unsafe file handling.
- API-key exposure (settings, logs, traces, backups, exports).
- SymPy/AST sandbox escape or command execution.
- Data corruption or cross-session leakage.

Out of scope:

- A malicious local process or user with access to the same OS account.
- Denial of service caused by intentionally huge local inputs beyond documented limits.
- Model-provider outages, quotas or content produced by external AI providers.
- Browser/GeoGebra CDN compromise outside the application's control.

## Local security model

- The server binds `127.0.0.1` by default.
- API keys are stored in `settings.json`, never returned by the API, and excluded from backups, traces and logs.
- Uploads/static paths are confined; SymPy input is parsed through an AST whitelist, not `eval`/`sympify`.
- Security-sensitive behavior is documented in [`docs/SECURITY-MODEL.md`](docs/SECURITY-MODEL.md) and covered by `test/test_server_security.mjs`.
- Do not expose the server to a network without TLS and an authenticating reverse proxy.
