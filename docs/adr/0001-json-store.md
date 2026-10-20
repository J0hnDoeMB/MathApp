# ADR 0001: atomic JSON store and quarantine

## Context
Sessions/settings/notes were written as plain JSON. A crash or partial write could truncate a session; a corrupt file could break history.

## Decision
Use `lib/json-store.mjs` for atomic writes (temp + rename) and quarantine corrupt files (rename to `.corrupt-<epoch>`, return fallback). Keep JSON for local simplicity; do not introduce a database yet.

## Consequences
- No partially written valid file replaces the old one.
- Corrupt sessions are isolated and visible, not fatal.
- Still single-writer and no multi-process transactions; migration/versioning remains in `lib/schema.mjs`.
