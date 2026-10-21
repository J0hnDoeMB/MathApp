# Known limitations

- **Local-first, single-user**: no multi-user auth or multi-writer transaction; SQLite is not used.
- **UI bundle**: the core `app.js` remains large; optional UI is lazy but core rendering/state is still one classic script.
- **Browser tests**: CI runs UI smoke, mobile viewport and self-contained XSS; layout/3D/conversation-switch/model-provider browser flows remain manual.
- **Coverage**: c8 reports Node line coverage, including child server processes, and enforces a 65% floor (69.9% measured); browser UI coverage is still incomplete.
- **AI eval**: math engine eval is deterministic; teacher-quality, GeoGebra quality and hallucination evals require real providers + human review and are not in CI.
- **Providers**: model catalogs and quotas change externally; capabilities/diagnostics surface failures but cannot prevent them.
- **GeoGebra/KaTeX**: CDN/browser dependency; offline use loses graphing/rendering.
- **Platforms**: the Node core (tests, eval, server) is tested on Linux/Node 18-22 in CI. Windows remains the supported setup path for PowerShell launchers. UI smoke runs on Linux CI; full browser flows, GeoGebra on Linux and Whisper remain manual.
- **Data**: a single instance per data directory is enforced by a PID lock with stale-owner recovery; there is no multi-user mode, multi-writer transaction or snapshot isolation.
