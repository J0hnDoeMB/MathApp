# Changelog

## v1.1.0 - 2026-10-19

### Changed
- Refactor: `server.mjs` split into `lib/config.mjs`, `lib/models.mjs`, `lib/llm.mjs` and `lib/log.mjs`; one client for OpenCode/OpenRouter. Behavior unchanged; both provider paths verified with a real chat.
- `server.mjs` is ~1,640 lines (from ~1,930); the remaining split (SymPy, KB, conversations, backups) is documented in `docs/ARCHITECTURE.md`.

## v1.0.3 - 2026-10-19

### Added
- Preflight `start-mathapp.ps1 -Check` (Node/Python/SymPy/Whisper/port/key).
- `GET /api/diagnostics` and the Settings "Funzionalità" panel.
- README core/optional matrix, troubleshooting guide and architecture notes.

## v1.0.2 - 2026-10-19

### Fixed
- Body limit raised to 64 MB so four 8 MB attachments (base64) fit.
- The OpenRouter primary path is no longer logged as a fallback.

## v1.0.1 - 2026-10-19

### Added
- Settings drawer: provider (OpenRouter or OpenCode Go), API key, default model, dictation language, first-run banner.
- `GET/POST /api/settings` with a masked key (only the last 4 characters are shown).
- Security smoke test (`test_server_security.mjs`) and CI test job.

### Fixed
- Settings button/save could be covered by the GeoGebra layer (drawers now stack above the applet).
- Drawers/quick-click race: settings listeners are bound immediately, not after the model fetch.
- Mojibake in server prompts/messages (accents and punctuation restored).
- Static file path boundary, request bodies limited to 12 MB, cross-origin POST/DELETE rejected, atomic `settings.json` writes, friendly port-in-use error, uncaught errors logged.

### Changed
- Auth/model paths are portable (`MATHAPP_AUTH_FILE`, `MATHAPP_MODELS_JSON`, `MATHAPP_PORT`, `MATHAPP_NO_WHISPER`).
- Launcher uses the script folder and honours `MATHAPP_PORT`; README documents the API key setup and quick tests.
