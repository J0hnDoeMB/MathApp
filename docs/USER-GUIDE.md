# MathApp - guida utente

MathApp è una lavagna di matematica che gira sul tuo PC: chat con un'IA, calcolo
esatto con SymPy e GeoGebra nella stessa pagina. Questa guida segue il percorso
di un utente che parte da zero; la reference completa resta in
[`USAGE.md`](USAGE.md).

## 1. In 60 secondi

1. Installa Node.js (su Windows puoi usare `setup.cmd`).
2. Avvia MathApp con `start-mathapp.ps1` (Windows) o `npm start` (macOS/Linux).
3. Apri `http://127.0.0.1:8790`.
4. Apri **Impostazioni**, scegli il provider e incolla la chiave API.
5. Scrivi una domanda nella chat; se vuoi disegnare, chiedi una figura.

Senza chiave API restano utilizzabili GeoGebra, il quaderno SymPy e le
conversazioni: manca solo la risposta dell'IA.

## 2. Cosa serve

| Componente | Obbligatorio | A cosa serve |
|---|---|---|
| Node.js 18 o superiore | sì | avvio, chat, GeoGebra, conversazioni |
| Chiave API OpenRouter o OpenCode Go | per la chat | risposte dell'IA |
| Browser recente (Edge, Chrome, Firefox, Safari) | sì | interfaccia e applet GeoGebra |
| Python + SymPy | no | calcolo esatto, studio di funzione, matrici, vettori |
| Python + pypdf | no | estrazione testo dai PDF |
| Python + faster-whisper | no | dettatura e trascrizione audio locale |

GeoGebra e KaTeX vengono caricati da CDN: senza internet la chat e il calcolo
restano disponibili, ma il disegno e il rendering delle formule no.

## 3. Installazione

### Windows

Doppio clic su `setup.cmd`, oppure da PowerShell:

```powershell
powershell -ExecutionPolicy Bypass -File .\setup.ps1
.\start-mathapp.ps1
```

`setup.ps1` scarica Node.js LTS portatile in `.tools\` e non richiede permessi
amministratore. Per SymPy e i PDF:

```powershell
.\setup.ps1 -Math
```

Per aggiungere anche la dettatura:

```powershell
.\setup.ps1 -Full
```

### macOS e Linux

```bash
npm start
```

Il browser va aperto manualmente su `http://127.0.0.1:8790`. Dettagli in
[`SETUP-MACOS-LINUX.md`](SETUP-MACOS-LINUX.md).

### Prima di iniziare: diagnostica

```powershell
.\start-mathapp.ps1 -Check
```

Mostra Node, Python, SymPy, Whisper, provider, porta e cartelle dati senza
avviare il server. Lo stesso stato è visibile in **Impostazioni > Funzionalità**
e tramite `/api/diagnostics`.

## 4. Configurare la chiave API

1. Apri **Impostazioni**.
2. Scegli il provider:
   - **OpenRouter**: crea una chiave su <https://openrouter.ai/keys>.
   - **OpenCode Go**: usa la chiave del tuo account OpenCode.
3. Incolla la chiave e salva. La chiave non viene mai mostrata dall'API.
4. Scegli il modello predefinito e, se vuoi, il livello di spiegazione.

La chiave è salvata solo in `settings.json`, sul tuo PC. Non viene inclusa nei
backup di `data/` e non viene inviata ad altri servizi oltre al provider scelto.
Per rimuoverla usa **Impostazioni > Rimuovi chiave** e, se necessario, revocala
dalla console del provider.

## 5. Usare la chat

- Scrivi nella casella in basso: **Invio** invia, **Shift+Invio** va a capo.
- **Stop** o `Esc` interrompe una risposta in corso.
- **Rigenera** o `Alt+R` ripete l'ultima risposta senza riscrivere la domanda.
- **Copia** copia una risposta in Markdown; un clic su una formula in blocco
  copia il LaTeX.
- **Modifica e rinvia** su un tuo messaggio riparte da quel punto.
- **Allega** accetta immagini, PDF, audio e file di testo (massimo 4 file,
  8 MB ciascuno).
- `Ctrl+K` porta il cursore nella casella, `Alt+N` apre una nuova chat.

Il badge **SymPy: N calcoli esatti** indica che la risposta ha usato calcolo
simbolico. Se compare un avviso, la risposta contiene matematica ma non è
passata dal calcolo esatto: controlla i passaggi.

### Modalità e livello

In **Impostazioni** puoi scegliere:

- **Essenziale (core)**: chat, GeoGebra, SymPy, conversazioni. È la modalità
  predefinita e quella consigliata per iniziare.
- **Completa**: aggiunge quiz, ripasso, appunti, stile, TTS e delega.

Il **livello di spiegazione** (Auto, Sintetico, Dettagliato, Approfondito)
cambia la quantità di passaggi e teoria, non i contenuti matematici.

## 6. Disegnare con GeoGebra

- Chiedi una figura in chat; l'IA prepara una **costruzione** con titolo e
  comandi modificabili.
- Controlla i comandi, correggili se serve, poi premi **Esegui** (sostituisce
  il grafico) o **Aggiungi** (sovrappone alla costruzione corrente).
- Il pannello **Costruzioni** elenca i disegni della sessione.
- **Figura / Algebra** cambia il pannello sinistro; **3D** mostra gli assi
  tridimensionali.
- **Vista** imposta xmin/xmax/ymin/ymax, assi e griglia; **Adatta** inquadra
  automaticamente i punti notevoli.
- Le costruzioni vengono salvate nella conversazione e ricaricate con F5.

## 7. Quaderno e sessione

Il pannello **Algebra** è un quaderno di calcolo esatto indipendente dall'IA:
scrivi un'espressione, scegli l'operazione e premi **Calcola**. Le operazioni
includono algebra, derivate, integrali, limiti, serie, matrici, vettori, studio
di funzione, statistica e regressione.

- Ogni calcolo è numerato e salvato nella sessione.
- Clicca un risultato per copiarlo; clicca l'espressione per rimetterla nel
  modulo.
- **Spiega** chiede all'IA i passaggi di quel calcolo.
- **Disegna** porta il risultato sulla lavagna.
- **Nuova chat** azzera conversazione, quaderno e allegati.
- **Cronologia** riapre una conversazione con figure e calcoli; la ricerca
  accetta anche tag come `#verifica`.

La sessione è **persistente**: F5 non cancella conversazione, figure o quaderno.
Se lo stato esatto manca, l'app prova a ricostruirlo dai comandi salvati.

## 8. Esportare, stampare e fare backup

- **PDF / MD** esporta la conversazione in una finestra pronta per la stampa o
  in un file Markdown.
- Nel quaderno puoi esportare il PDF dei calcoli e i grafici in PNG.
- I dati stanno in `data/` (`conversations/`, `kb/`, `backup/`, ...).
- I backup automatici stanno in `data/backup/`; copia quella cartella su un
  supporto esterno se vuoi conservarla.
- `settings.json` contiene la configurazione e la chiave API: non è dentro
  `data/` e non viene incluso nei backup automatici.

## 9. Privacy e sicurezza

- MathApp ascolta solo su `127.0.0.1`: non esporre la porta su Internet senza
  aggiungere autenticazione e HTTPS.
- Le richieste di modifica da altre origini vengono rifiutate (CSRF).
- La chiave API resta in `settings.json` e viene inviata solo al provider
  scelto via HTTPS.
- L'app non ha telemetria e non invia dati a server propri.
- I calcoli SymPy sono eseguiti in locale; la dettatura Whisper è locale.
- Non aprire `settings.json` in repository pubblici o condividerlo.

## 10. Problemi comuni

| Sintomo | Cosa controllare |
|---|---|
| La chat non risponde | chiave API presente e valida; provider/modello in Impostazioni |
| Errore 401/403 dal provider | chiave scaduta o revocata; aggiornala o cambia provider |
| GeoGebra non compare | connessione internet e blocco CDN del browser |
| Le formule non si vedono | CDN KaTeX bloccata o browser troppo vecchio |
| SymPy non disponibile | esegui `setup.ps1 -Math`; controlla Python in `-Check` |
| Il microfono non parte | apri da `127.0.0.1`, non da un IP di rete; controlla i permessi |
| Porta 8790 occupata | chiudi l'altra istanza o imposta `MATHAPP_PORT` |
| Dopo F5 manca qualcosa | apri la console del browser: il ripristino logga il motivo |

Altri casi in [`TROUBLESHOOTING.md`](TROUBLESHOOTING.md). Per lo sviluppo e i
test vedi [`ONBOARDING.md`](ONBOARDING.md) e [`QUALITY-GATE.md`](QUALITY-GATE.md).

## 11. Scorciatoie

| Tasto | Azione |
|---|---|
| `Invio` | invia |
| `Shift+Invio` | nuova riga |
| `Esc` | ferma la risposta |
| `Alt+R` | rigenera |
| `Alt+N` | nuova chat |
| `Ctrl+K` | cursore nella casella |
| `Tab` | raggiunge il link "Vai alla chat" e i controlli |

## 12. Dove trovare altro

- Guida completa e funzioni avanzate: [`USAGE.md`](USAGE.md)
- Installazione Windows: [`SETUP-WINDOWS.md`](SETUP-WINDOWS.md)
- Installazione macOS/Linux: [`SETUP-MACOS-LINUX.md`](SETUP-MACOS-LINUX.md)
- Architettura e contratti: [`ARCHITECTURE.md`](ARCHITECTURE.md),
  [`CONTRACTS.md`](CONTRACTS.md)
- Limiti noti: [`KNOWN-LIMITATIONS.md`](KNOWN-LIMITATIONS.md)
