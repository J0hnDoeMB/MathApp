# ADR 0002: lazy UI plugins for optional features

## Context
Quiz/review/KB/TTS/style code lived in the core `app.js` even when the app ran in core mode.

## Decision
Optional UI lives in `public/features/*.js`, loaded by `public/features.js` only in full mode. Plugins register an `init(app)` and receive the restricted `MathAppApp` API + `MathAppState`.

## Consequences
- Core mode never downloads optional UI.
- Optional features have an explicit contract and can be tested/loaded independently.
- Plugins still use DOM and shared CSS; moving all UI state out of `app.js` is a later step.
