# Setup macOS / Linux

MathApp non richiede installazione: è un server Node locale. Gli script `setup.ps1` e `start-mathapp.ps1` sono solo per Windows.

## Core (solo Node)

Requisiti: Node.js 18+ (consigliato LTS).

```bash
cd MathApp
npm start
```

Apri http://127.0.0.1:8790. Non servono `npm install` né dipendenze runtime.

Se serve un'altra porta:

```bash
MATHAPP_PORT=8791 npm start
```

## Calcolo esatto e PDF (opzionale)

Serve Python 3. Il server invoca il comando `python`, quindi usa un virtualenv (che crea `python`, non solo `python3`):

```bash
python3 -m venv .venv
. .venv/bin/activate
python -m pip install --upgrade pip
python -m pip install -r requirements.txt
npm start
```

`requirements.txt` installa SymPy e pypdf. Senza Python la chat e GeoGebra funzionano; il quaderno esatto e l'estrazione PDF sono disabilitati.

## Dettatura (opzionale)

```bash
. .venv/bin/activate
python -m pip install -r requirements-whisper.txt
```

Il primo uso scarica il modello Whisper in `~/.cache/huggingface` (può richiedere minuti). La trascrizione avviene in locale.

## GeoGebra / KaTeX

Sono caricati dal browser via CDN: serve internet. Senza rete restano chat, sessioni e calcolo esatto, ma non il disegno/rendering delle formule.

## Dati e configurazione

- `settings.json` nella cartella dell'app: provider, API key, modello, lingua.
- `data/`: conversazioni, appunti, backup.
- La chiave non viene restituita dall'API, non finisce nei log/trace e non è inclusa nei backup.

## Diagnostica e test

```bash
curl http://127.0.0.1:8790/api/diagnostics
curl http://127.0.0.1:8790/api/health
npm test
npm run eval
```

I test browser (`npm run test:ui`, `npm run test:geo`) richiedono Chrome/Edge e `puppeteer-core`; non sono necessari per usare l'app.

## Problemi comuni

- **`python` non trovato**: attiva il virtualenv (`. .venv/bin/activate`) o crea un alias `python` verso Python 3.
- **Porta occupata**: usa `MATHAPP_PORT=8791 npm start`.
- **GeoGebra non compare**: controlla la rete/CDN e la console del browser.
- **Whisper lento**: il primo caricamento scarica il modello; gli usi successivi sono più rapidi.
- **Nessun accesso da un altro dispositivo**: il server ascolta solo su `127.0.0.1`. Non esporlo senza autenticazione/reverse proxy.
