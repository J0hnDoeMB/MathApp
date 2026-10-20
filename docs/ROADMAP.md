# Roadmap

MathApp vuole essere **due cose insieme**, ma con un confine netto:

- **A. Tutor per lo studente** — chat, algebra esatta, GeoGebra, spiegazioni, sessione.
- **B. Piattaforma didattica** — quiz, ripasso, appunti, audio, TTS, backup.

La direzione è tenere entrambe, ma il **core** deve restare stabile e le funzioni B devono essere moduli opzionali. Nessuna nuova feature entra nel core finché la fase 1 non è chiusa.

## Fase 1 — Stabilizzazione (in corso)

Obiettivo: core chat + algebra + grafo + sessione affidabili.

- [x] core mode (`settings.mode = core`) e feature complete opzionali
- [x] separazione `server.mjs` → `lib/*` (storage, KB, profile, SymPy, GeoGebra, documenti, audio, prompt, tool, agent)
- [x] test di sessione: stato, `ggb`, `cells`, `view`, revisione stale, cronologia
- [x] test del loop agente con upstream finto (tool call → SymPy → verifica → done)
- [x] security/API smoke (CSRF, body cap, traversal, settings, core/full)
- [x] CI: moduli, agente, parser, security; SymPy prima dei test; branch protection
- [x] split dei route handler in `routes/` (server ~60 righe, solo composizione)
- [x] test browser smoke in CI (nuova chat, restore sessione/stato, view)
- [x] test browser dedicato al rebuild dell'applet GeoGebra (`test_geogebra_smoke.mjs`, 5 check in CI)

**Exit criteria:** tutti i check verdi, nessuna regressione nota su chat/sessione/stato, branch `main` protetto, nessuna feature B nel core.

## Fase 2 — Funzioni didattiche (in corso)

Feature modules con contratti espliciti, senza nuove UI in questa fase:

- [x] route split: backup, kb, profile, review, study, compute
- [x] SM-2 in `lib/review.mjs` + test
- [x] prompt/generazione flashcard e quiz in `lib/study.mjs` + test con modello finto
- [x] gate core/full in `lib/features.mjs` + test
- [x] session repository (`lib/session-store.mjs`) e schema/migrazioni (`lib/schema.mjs`)
- [x] chat orchestrator (`lib/chat-service.mjs`) e security guard (`lib/security.mjs`)
- [x] store client domain/UI (`public/state.js`) con eventi
- [x] migrare i call site di `app.js` a `MathAppState` (accessori rimossi)
- [x] plugin loader backend per feature opzionali (kb/profile/review/study on-demand)
- [x] lazy loading UI: loader + quiz
- [x] migrare review/KB/TTS/stile al loader UI
- [x] command bus per session.new/chat.send/session.restore
- [ ] event model per tutti i flussi UI → application

**Exit criteria:** ogni feature ha un test dedicato, un limite di errore isolato (un provider/PDF/audio rotto non blocca chat e grafo) e un toggle core/full.

## Fase 3 — Polishing

- onboarding primo avvio e guida in-app
- packaging Windows e release workflow
- accessibilità e UX mobile
- documentazione per utenti finali
- metriche di errore e diagnostica

## Regola di feature freeze

Niente nuove feature finché non sono verdi:

1. test sessione/persistenza
2. test chat + tool call
3. test GeoGebra state
4. test API/sicurezza
5. CI su `main`

Le funzioni B restano disattivabili in un click e non devono introdurre dipendenze nel core.
