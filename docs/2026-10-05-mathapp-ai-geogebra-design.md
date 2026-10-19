# MathApp — chat AI + GeoGebra + LaTeX (locale, solo PC)

Data: 2026-10-05
Stato: design approvato (in attesa di revisione dello spec)

## Obiettivo

Un'unica app locale sul PC: una pagina con **GeoGebra embeddato** e un **pannello chat AI**.
L'IA spiega a parole e in **LaTeX**, e quando serve **disegna nell'applet GeoGebra che l'utente vede e può manipolare**.
Niente cloud: solo uso locale dal PC (localhost va bene).

## Vincoli e decisioni chiave

- **Solo locale**: il PC ospita tutto; apertura da browser del PC.
- **Cervello LLM**: provider **OpenCode Go**, endpoint `https://opencode.ai/zen/go/v1` (OpenAI-compatible).
  - Header obbligatori (verificati dal vivo): `Authorization: Bearer <key opencode-go>`,
    `User-Agent` proprio (es. `mathapp/1.0`), `x-opencode-session: <id stabile per conversazione>`.
  - Chiave configurabile dalle Impostazioni dell app (settings.json) oppure, in compatibilita, da auth.json di OpenCode (mai hardcoded).
  - **Tool-calling verificato**: il modello restituisce correttamente `tool_calls` (anche in streaming, come delta da accumulare — formato OpenAI).
  - **Streaming SSE verificato**: il server inoltra i delta di testo al browser.
- **Modelli** (dropdown, default `deepseek-v4.1-flash`):
  - default: `deepseek-v4.1-flash`
  - economici: `deepseek-v4-flash`, `glm-5.3-flash`, `mimo-v2.6-flash`, `qwen3.8-flash`
  - free: `longcat-2.5-preview-free`, `space-bunny-free`
- **Calcolo esatto**: SymPy locale (riuso della logica del server MCP SymPy).
- **Render math**: KaTeX (CDN). **GeoGebra**: `deployggb.js` (CDN). Serve internet (come per l'IA).

## Architettura

```
MathApp\
  server.mjs          # server HTTP locale (Node, zero dipendenze) + loop agente + SSE
  sympy_cli.py        # calcolo esatto: legge JSON, scrive JSON (riuso logica sympy_server.py)
  public/
    index.html        # layout: GeoGebra + pannello chat
    app.js            # chat, streaming, KaTeX, esecuzione comandi GeoGebra
    style.css         # tema/layout
  start-mathapp.ps1   # avvia server (hidden) + apre il browser
  README.md           # come si avvia, come si usa
```

- **Server** (`server.mjs`, Node built-in `http`/`fetch`):
  - serve `public/` su `127.0.0.1:8790`
  - `POST /api/chat` → streaming **SSE** della risposta
  - `POST /api/geogebra-result` → il browser conferma l'esecuzione dei comandi GeoGebra
  - esecuzione tool: `sympy_compute` (spawn `python sympy_cli.py`), `geogebra` (evento verso il browser)
- **Front-end** (`index.html` + `app.js`): GeoGebra applet + chat + KaTeX + selettore modello + "nuova chat".

## Flusso dati (loop agente)

1. L'utente scrive nel pannello chat.
2. Il server invia i messaggi all'IA con i tool disponibili e `x-opencode-session` della conversazione.
3. L'IA risponde in streaming → il testo appare subito (Markdown + LaTeX).
4. Se l'IA chiama un tool:
   - `sympy_compute` → il server esegue SymPy e restituisce il **risultato esatto** all'IA, che poi lo spiega.
   - `geogebra` → il server manda i comandi al browser via SSE (`{callId, commands}`); l'applet li esegue
     con `ggbApplet.evalCommand`; il browser risponde con gli esiti; il server li restituisce all'IA.
     (Timeout 10 s → esito parziale, per non bloccare.)
5. L'IA continua fino alla risposta finale; l'utente può anche muovere GeoGebra a mano in parallelo.

## Tool esposti all'IA

- `sympy_compute`: `operation` (simplify|diff|integrate|limit|series|expand|factor|apart|together|solve|dsolve|det|inverse|transpose|eigenvals|eigenvects|rank|rref|evaluate|latex), `expr`, `var`, `lower`, `upper`, `point`, `order`, `matrix`, `subs`.
- `geogebra`: `commands: string[]` (es. `["f(x)=sin(x)/x", "L=Limit(f,0)"]`).

## Interfaccia

- GeoGebra a sinistra (~65%), chat a destra (~35%).
- Pulsante **Nascondi GeoGebra** → chat a tutta larghezza (modalità "solo LaTeX/testo").
- Chat: Markdown + **KaTeX**, streaming token, indicatore "sta pensando…" (usa `reasoning_content`).
- Selettore modello, pulsante "Nuova chat" (azzera conversazione → nuovo `x-opencode-session`).
- I comandi GeoGebra eseguiti dall'IA sono visibili in un piccolo log sotto la chat.

## Gestione errori

- Chiave mancante / rete assente / HTTP != 200 → messaggio chiaro in chat, nessun crash.
- Tool `sympy` che fallisce → l'errore torna all'IA, che si adatta (niente blocchi).
- Tool `geogebra` senza risposta dal browser entro 10 s → si prosegue con esito parziale.

## Verifica (prima di dire "fatto")

1. `python sympy_cli.py '{"operation":"integrate","expr":"x^2*exp(-x)","var":"x","lower":"0","upper":"oo"}'` → `2`.
2. `curl` su `/api/chat` con un prompt di prova → streaming SSE corretto + uso tool.
3. Browser: chiedo un argomento → testo+LaTeX; chiedo un grafico → l'applet GeoGebra si aggiorna.

## Fuori scope (v1)

- Hosting/cloud, accesso mobile, autenticazione, persistenza delle conversazioni, upload immagini.
