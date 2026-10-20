# Technical onboarding

## 1. Avvio

```powershell
.\setup.cmd
.\start-mathapp.ps1
```

Solo Node è obbligatorio. `-Math` aggiunge SymPy/pypdf; `-Full` aggiunge Whisper. Dettagli in [`SETUP-WINDOWS.md`](SETUP-WINDOWS.md).

## 2. Mappa del codice

- `server.mjs` — HTTP, route, validazione, SSE, startup. Non deve contenere logica di dominio.
- `lib/agent.mjs` — loop agente, tool call, escalation, delega.
- `lib/prompts.mjs` / `lib/tools.mjs` — prompt e schema strumenti.
- `lib/sympy.mjs` — calcolo esatto (processo Python).
- `lib/geogebra.mjs` — ponte con l'applet.
- `lib/documents.mjs` / `lib/audio.mjs` — PDF/testo e Whisper.
- `lib/kb.mjs` / `lib/profile.mjs` — appunti e stile.
- `lib/storage.mjs` — conversazioni, ripasso, backup.
- `lib/llm.mjs` — provider AI (OpenRouter/OpenCode).
- `public/` — UI browser.

Dipendenza consentita: `server → agent → servizi → storage/config`. I servizi non importano `server.mjs` e non usano `req/res`.

## 3. Aggiungere una funzione

1. Deve stare in un modulo `lib/` o in un adapter, non nel core di `server.mjs`.
2. Deve essere attivabile/disattivabile (core/full) se non è essenziale.
3. Deve avere un test senza rete quando possibile.
4. Un errore del provider, PDF, audio o GeoGebra non deve bloccare chat e sessione.
5. Aggiornare `docs/ARCHITECTURE.md`, `docs/ROADMAP.md` e il CHANGELOG.

## 4. Test

```powershell
npm test              # 64 check: moduli, agente, parser, security/sessione
npm run test:ui       # 15 check browser (richiede browser)
npm run test:geo      # 5 check GeoGebra (richiede rete CDN)
npm run test:py       # parser SymPy
node test_server_cancel.mjs
```

I test browser richiedono Puppeteer e l'app avviata; vedi README.

## 5. Contratti principali

- `runAgent(payload, sessionId, send, isGone, signal, deps?)` — emette eventi SSE; `deps` serve solo ai test.
- `runSympy(args) -> Promise<{ok, result, ...}>` — non lancia per errori di calcolo.
- `runGGB(send, commands, ...) -> Promise` — attende la conferma del browser con timeout.
- `audioToText(b64)` / `docToText(name, mime, b64)` — adapter isolati.
- `runBackup()` — zip di `data/`; non include `settings.json`.
