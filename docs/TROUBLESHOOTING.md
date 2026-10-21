# Troubleshooting

## Il server non parte
- **Node mancante o troppo vecchio**: serve Node 18+ (22.5+ consigliato). `node -v`.
- **Porta occupata**: un'altra istanza è già in ascolto. Chiudila oppure usa `MATHAPP_PORT=8791` (e apri `http://127.0.0.1:8791`).
- **"another instance is already using ..."**: c'? gi? un processo sulla stessa data directory. Chiudilo; per test o istanze parallele usa una `MATHAPP_DATA_DIR` diversa. Il lock (`data/.mathapp-instance.lock`) viene recuperato da solo se il PID non ? pi? attivo.
- **Errore all'avvio**: controlla `mathapp.log` nella cartella dell'app; la console stampa un messaggio chiaro.

## Python / SymPy non ci sono
La chat, GeoGebra e le conversazioni funzionano lo stesso. Per il calcolo esatto:
```powershell
python -m pip install sympy
```
Poi riavvia l'app (o premi "Ricontrolla" in Impostazioni).

## Whisper non c'è
La dettatura è opzionale. Per abilitarla:
```powershell
python -m pip install faster-whisper
```
Il primo utilizzo scarica il modello (richiede tempo/spazio). Senza Whisper il resto dell'app funziona.

## GeoGebra non si carica
GeoGebra e KaTeX arrivano da CDN: serve internet. Senza CDN la chat e il quaderno algebrico restano utilizzabili, ma la lavagna no.

## Errori dall'API (401/403, modello non valido)
- La chiave è sbagliata/scaduta o è di un altro provider: apri **Impostazioni**, scegli il provider giusto e incolla una chiave valida (OpenRouter: <https://openrouter.ai/keys>).
- Il modello selezionato non è disponibile per quel provider: scegline un altro nella lista.
- Con OpenCode Go la chiave deve essere quella di OpenCode; con OpenRouter una `sk-or-v1-...`.
- La chiave viene salvata in `settings.json`, mai mostrata: se la cambi, il campo resta vuoto e vedi solo gli ultimi 4 caratteri.

## Microfono
La dettatura funziona da `http://127.0.0.1:8790` o HTTPS (contesto sicuro richiesto dal browser). Concedi il permesso al sito.

## settings.json corrotto o perso
- Elimina `settings.json` e riconfigura da **Impostazioni** (la chiave non è recuperabile, va reinserita).
- Le conversazioni sono in `data/`; i backup in `backups/`.
- Per ripristinare un backup: ferma MathApp e lancia `node scripts/restore-backup.mjs [file.zip]`.

## Aggiornamento
Sostituisci i file del codice, riavvia l'app e verifica con `.\start-mathapp.ps1 -Check`. Non copiare `settings.json`/`data/` da altre installazioni se non vuoi mescolare i dati.
