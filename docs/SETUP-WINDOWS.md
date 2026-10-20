# Setup Windows

MathApp funziona con il solo **Node.js**: chat, GeoGebra, conversazioni e interfaccia. Python, SymPy, pypdf e Whisper sono opzionali.

## Avvio rapido

Doppio click su **`setup.cmd`** (oppure, da PowerShell, `powershell -ExecutionPolicy Bypass -File .\setup.ps1`). Poi avvia con:

```powershell
.\start-mathapp.ps1
```

`setup.ps1` scarica **Node.js LTS portatile** in `.tools\` (circa 30 MB, nessun privilegio di amministratore) e controlla l'ambiente. Poi `start-mathapp.ps1` avvia l'app su http://127.0.0.1:8790.

Al primo avvio apri **Impostazioni**, scegli il provider (OpenRouter consigliato) e incolla la API key. La chiave resta in `settings.json` sul PC.

## Opzioni

| Comando | Cosa fa |
|---|---|
| `.\setup.ps1` | Node portatile + controllo. È tutto ciò che serve per il core. |
| `.\setup.ps1 -Math` | Aggiunge Python (via winget se manca), SymPy e pypdf. |
| `.\setup.ps1 -Full` | Come `-Math` più `faster-whisper` per la dettatura. |
| `.\setup.ps1 -Check` | Mostra Node/Python/SymPy/Whisper senza scaricare nulla. |
| `.\setup.ps1 -Force` | Riscarica Node anche se è già presente. |

Esempi:

```powershell
# Solo controllo
.\setup.ps1 -Check

# Calcolo esatto + estrazione PDF
.\setup.ps1 -Math

# Tutto, inclusa la dettatura locale
.\setup.ps1 -Full
```

## Cosa viene installato e dove

- `.tools\node-v...-win-x64\` — Node portatile, usato solo da MathApp. La cartella è in `.gitignore`.
- `settings.json` — preferenze e API key (locale, non versionata).
- `data\` — conversazioni, appunti, backup.
- Python/SymPy/Whisper, se richiesti, restano nell'installazione Python dell'utente (`pip install --user`).

## Se qualcosa non funziona

- **Script bloccato da PowerShell**: usa `powershell -ExecutionPolicy Bypass -File .\setup.ps1` oppure `Set-ExecutionPolicy -Scope Process Bypass`.
- **Download Node bloccato** (proxy/firewall): installa Node LTS da https://nodejs.org/ e rilancia `.\setup.ps1`; lo script lo rileva dal PATH.
- **Python non trovato dopo winget**: chiudi e riapri PowerShell, poi `.\setup.ps1 -Math`.
- **SymPy non disponibile**: `python -m pip install --user -r requirements.txt`.
- **Dettatura**: `python -m pip install --user -r requirements-whisper.txt`; il modello Whisper viene scaricato al primo uso.
- **Porta occupata**: imposta `MATHAPP_PORT` (es. `$env:MATHAPP_PORT=8791`) prima di avviare.
- **Errore all'avvio**: controlla `mathapp.log` nella cartella dell'app.

## Disinstallare

- Node portatile: elimina `.tools\`.
- Dipendenze Python: `python -m pip uninstall sympy pypdf faster-whisper`.
- Dati e chiave: elimina `settings.json` e `data\` (operazione irreversibile).
