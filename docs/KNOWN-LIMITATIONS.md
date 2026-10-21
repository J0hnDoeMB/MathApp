# Known limitations

- **Local-first, single-user**: no multi-user auth or multi-writer transaction; SQLite is not used.
- **UI bundle**: the core `app.js` remains large; optional UI is lazy but core rendering/state is still one classic script.
- **Browser tests**: CI runs a smoke subset; XSS/layout/3D/model-provider tests are manual.
- **Coverage**: line coverage is not instrumented yet; the gate is behavior tests, not a coverage threshold.
- **AI eval**: math engine eval is deterministic; teacher-quality, GeoGebra quality and hallucination evals require real providers + human review and are not in CI.
- **Providers**: model catalogs and quotas change externally; capabilities/diagnostics surface failures but cannot prevent them.
- **GeoGebra/KaTeX**: CDN/browser dependency; offline use loses graphing/rendering.
- **Platforms**: the Node core (tests, eval, server) is tested on Linux/Node 18-22 in CI. Windows remains the supported setup path for PowerShell launchers; browser/GeoGebra and Whisper are tested manually.
- **Data**: no snapshot isolation or cross-process locking; a single app instance per data directory is expected.
