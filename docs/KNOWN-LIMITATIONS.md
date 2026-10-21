# Known limitations

- **Local-first, single-user**: no multi-user auth or multi-writer transaction; SQLite is not used.
- **UI bundle**: the core `app.js` remains large (~2.5k lines), though Markdown/KaTeX, formatting, note sources and export helpers now live in `public/core/`; optional UI is lazy, core rendering/state is still one classic script.
- **Browser tests**: CI runs UI smoke, mobile viewport, self-contained XSS and conversation-switch regression; layout/3D and model-provider browser flows remain manual.
- **Coverage**: c8 reports Node line coverage, including child server processes, and enforces a 65% floor (71.1% measured); browser UI coverage is still incomplete.
- **AI eval**: math engine eval is deterministic; teacher-quality, GeoGebra quality and hallucination evals require real providers + human review and are not in CI.
- **Providers**: model catalogs and quotas change externally; capabilities/diagnostics surface failures but cannot prevent them.
- **GeoGebra/KaTeX**: a brand-new install needs one online visit for the CDN assets; after that `public/sw.js` serves the shell and cached CDN files offline. Updating a cached dependency requires a cache-version bump.
- **Platforms**: the Node core (tests, eval, server) is tested on Linux/Node 18-22 in CI. Windows remains the supported setup path for PowerShell launchers. UI smoke runs on Linux CI; full browser flows, GeoGebra on Linux and Whisper remain manual.
- **Data**: a single instance per data directory is enforced by a PID lock with stale-owner recovery; there is no multi-user mode, multi-writer transaction or snapshot isolation.
