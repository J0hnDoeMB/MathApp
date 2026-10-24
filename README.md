# MathApp

[![tests](https://github.com/J0hnDoeMB/MathApp/actions/workflows/syntax.yml/badge.svg)](https://github.com/J0hnDoeMB/MathApp/actions/workflows/syntax.yml) [![portable](https://github.com/J0hnDoeMB/MathApp/actions/workflows/portable.yml/badge.svg)](https://github.com/J0hnDoeMB/MathApp/actions/workflows/portable.yml)

Tutor di matematica **locale** con chat AI, GeoGebra e calcolo esatto SymPy. La API key resta sul tuo PC.

Percorso guidato per il primo avvio: [`docs/USER-GUIDE.md`](docs/USER-GUIDE.md).

![Chat con GeoGebra in azione](docs/chat-geogebra.png)

## Avvio rapido

### Windows

Doppio click su **`setup.cmd`**, poi `start-mathapp.ps1`. Oppure:

```powershell
powershell -ExecutionPolicy Bypass -File .\setup.ps1
.\start-mathapp.ps1
```

`setup.ps1` scarica Node.js LTS portatile in `.tools\` (nessun admin). Con `-Math` installa Python/SymPy/pypdf; con `-Full` anche faster-whisper.

### macOS / Linux

Serve Node.js 18+ e, facoltativamente, Python 3:

```bash
python3 -m venv .venv
. .venv/bin/activate
python -m pip install -r requirements.txt   # SymPy + pypdf (opzionale)
npm start
```

Apri `http://127.0.0.1:8790`. `setup.ps1`/`start-mathapp.ps1` sono solo Windows; su macOS/Linux il core è `npm start`. Per la dettatura: `pip install -r requirements-whisper.txt`. Dettagli: [`docs/SETUP-MACOS-LINUX.md`](docs/SETUP-MACOS-LINUX.md).

## Cosa include

- **Core**: chat, sessioni/cronologia paginata, GeoGebra, SymPy, backup automatici configurabili, sicurezza.
- **Offline**: dopo il primo caricamento il service worker conserva UI e asset CDN (GeoGebra/KaTeX); le API e i dati utente non vengono mai messi in cache.
- **Completa** (opzionale): quiz, ripasso, appunti/KB, flashcard, TTS, dettatura, stile. Si attiva da **Impostazioni → Modalità**.
- **BYO key**: OpenRouter o OpenCode Go, configurata in Impostazioni. Nessuna telemetria; la chiave non è nei backup.

## Qualità

```bash
npm run lint      # ESLint (no-undef e regole di correttezza)
npm test          # 135 check Node
npm run test:ui   # 29 check browser (richiede Edge/Chrome + puppeteer-core)
npm run test:xss  # 14 check browser XSS (richiede Edge/Chrome + puppeteer-core)
npm run test:switch # 1 check cambio conversazione (richiede Edge/Chrome + puppeteer-core)
npm run test:geo  # 5 check GeoGebra (richiede CDN)
npm run eval      # 17 casi SymPy
npm run coverage  # copertura Node (soglia 65%)
npm run test:py   # 29 test Python (opzionale)
npm run eval:ai   # eval con provider reale, solo con chiave
```

Per una release: `npm run package` crea `release/mathapp-v<versione>.zip` (sorgente, richiede worktree pulito).

CI su Windows e Linux (Node 18/20/22) con branch protection. Diagnostica: `GET /api/diagnostics` (alias `/api/health`) o `.\start-mathapp.ps1 -Check`.

## Documentazione

- [Guida completa](docs/USAGE.md)  [Contributing](CONTRIBUTING.md)  [Security](SECURITY.md)
- [Architettura](docs/ARCHITECTURE.md) · [Contratti](docs/CONTRACTS.md) · [Modello dati](docs/DATA-MODEL.md) · [Persistenza](docs/PERSISTENCE.md)
- [Capabilities](docs/CAPABILITIES.md) · [Sicurezza](docs/SECURITY-MODEL.md) · [Performance](docs/PERFORMANCE.md) · [Scorecard](docs/SCORECARD.md)
- [Setup Windows](docs/SETUP-WINDOWS.md) · [Setup macOS/Linux](docs/SETUP-MACOS-LINUX.md) · [Troubleshooting](docs/TROUBLESHOOTING.md)
- [Quality gate](docs/QUALITY-GATE.md)  [Release](docs/RELEASE.md)  [Osservability](docs/OBSERVABILITY.md)  [Limiti noti](docs/KNOWN-LIMITATIONS.md)  [ADR](docs/adr/)

## Struttura

```text
server.mjs        guscio HTTP
routes/           API (core + plugin opzionali on-demand)
lib/              dominio, adapter, storage, sicurezza, diagnostica
public/           UI, state store, feature plugins lazy
test/             test Node/browser/Python
eval/             casi matematici deterministici
docs/             guide, contratti e decisioni
```

Licenza MIT.
