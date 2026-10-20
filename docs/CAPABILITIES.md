# Capabilities e degrado controllato

Il core deve funzionare dichiarando cosa manca, non fallendo in modo opaco. `lib/capabilities.mjs` produce lo stato usato da `/api/diagnostics` e `/api/health`.

| Capability | Obbligatoria | Se manca |
|---|---|---|
| `chat` | sì | non c'è tutoring |
| `provider` | sì | la chat non risponde: inserire la chiave |
| `storage` | sì | sessioni/backup non affidabili: controllare permessi |
| `math` (SymPy) | no | chat/GeoGebra restano; niente calcolo esatto |
| `documents` (pypdf) | no | niente estrazione PDF |
| `audio` (Whisper) | no | niente dettatura |
| `geogebra` | no | richiede browser + CDN |
| `tts` | no | dipende da `speechSynthesis` del browser |
| `fullFeatures` | no | modalità essenziale; quiz/ripasso/KB/stile/TTS UI non caricate |

## Stati

- `ok`: disponibile.
- `optional-missing`: capability extra assente, fallback attivo.
- `missing-key`: provider non configurato.
- `not-writable`: storage non scrivibile.
- `browser`: dipendenza lato browser (GeoGebra/TTS), non verificabile dal server.
- `core`/`enabled`: modalità feature.

## Diagnostica

```powershell
.\start-mathapp.ps1 -Check
curl http://127.0.0.1:8790/api/diagnostics
curl http://127.0.0.1:8790/api/health
```

La risposta include `capabilities`, `coreOk`, `dataDirOk`, `backupDirOk`, `port`, provider e dipendenze opzionali.
