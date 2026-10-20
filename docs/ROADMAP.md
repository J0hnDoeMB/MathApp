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
- [ ] split dei route handler in `routes/` (solo composizione in `server.mjs`)
- [ ] test browser smoke in CI (almeno nuova chat, restore, GeoGebra state)

**Exit criteria:** tutti i check verdi, nessuna regressione nota su chat/sessione/stato, branch `main` protetto, nessuna feature B nel core.

## Fase 2 — Funzioni didattiche

Solo dopo la fase 1, come **feature modules** con contratti espliciti:

- quiz e flashcard
- ripasso/SM-2
- appunti e citazioni documentali
- dettatura/TTS
- upload e pipeline documenti
- backup/restore

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
