// MathApp server — chat AI (OpenCode Go) + tool SymPy + GeoGebra in streaming.
// Node built-in only. Avvio: node server.mjs
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { spawn, spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import crypto from "node:crypto";
import { parseCards } from "./lib/flashparse.mjs";
import { parseQuiz } from "./lib/quizparse.mjs";
import { settings as SETTINGS, SETTINGS_FILE, MAX_BODY, providerName, keySource, currentKey, getKey, saveSettingsFile, detectOptional } from "./lib/config.mjs";
import { MODELS, MODEL_VISION, VISION_FALLBACK, MODEL_CAPS, pickSpecialist, OR_MODEL_MAP } from "./lib/models.mjs";
import { logErr } from "./lib/log.mjs";
import { streamUpstream, callModel, transcribeImages } from "./lib/llm.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.MATHAPP_PORT) || 8790;
const SYMPY_CLI = path.join(__dirname, "sympy_cli.py");
const EXTRACT_PY = path.join(__dirname, "extract.py");
const TRANSCRIBE_PY = path.join(__dirname, "transcribe.py");
const WHISPER_MODEL = SETTINGS.whisperModel || "large-v3-turbo";
let WHISPER_LANG = SETTINGS.whisperLanguage || "it";
const WHISPER_TIMEOUT_MS = Math.max(30000, Number(process.env.MATHAPP_WHISPER_TIMEOUT_MS) || 30 * 60 * 1000);
const WHISPER_IDLE_MS = Math.max(1000, Number(process.env.MATHAPP_WHISPER_IDLE_MS) || 2 * 60 * 60 * 1000);
// Modalità essenziale (default): chat + GeoGebra + SymPy + conversazioni.
// Solo "full" abilita quiz, ripasso, appunti, stile, TTS e delega.
const isFullMode = () => SETTINGS.mode === "full";
const LEVELS = ["auto", "breve", "dettagliato", "approfondito"];
function normalizeLevel(l) {
  const alias = { base: "breve", superiore: "dettagliato", universita: "approfondito" };
  const v = alias[l] || l;
  return LEVELS.includes(v) ? v : null;
}
function levelRule() {
  const l = normalizeLevel(SETTINGS.level) || "auto";
  const rules = {
    auto: "deduci il dettaglio richiesto dalla domanda; se non e' chiaro parti da una spiegazione completa ma senza digressioni.",
    breve: "risposta sintetica: solo i passaggi essenziali, niente digressioni; una riga di contesto e il risultato.",
    dettagliato: "spiega ogni passaggio e il perche'; aggiungi un esempio concreto quando aiuta; e' il livello piu' equilibrato.",
    approfondito: "aggiungi definizioni, ipotesi, varianti, controesempi e collegamenti; puoi essere piu' lungo, ma resta ordinato e pertinente.",
  };
  return "\n- LIVELLO (" + l + "): " + rules[l];
}
const AUDIO_EXT = /\.(mp3|wav|m4a|m4b|ogg|oga|opus|flac|webm|aac|wma|amr|3gp|mp4)$/i;
const PUBLIC = path.join(__dirname, "public");
const CONVDIR = path.join(__dirname, "data", "conversations");
try { fs.mkdirSync(CONVDIR, { recursive: true }); } catch {}

function convFile(id) { return path.join(CONVDIR, String(id).replace(/[^a-zA-Z0-9_-]/g, "") + ".json"); }
function saveConv(id, model, msgs) {
  if (!id) return;
  const p = convFile(id);
  let old = null;
  try { old = JSON.parse(fs.readFileSync(p, "utf8")); } catch {}
  const firstUser = msgs.find((m) => m.role === "user");
  const title = (old && old.title) || (firstUser ? firstUser.content.replace(/\s+/g, " ").trim().slice(0, 90) : "Nuova chat");
  const conv = {
    id, title, createdAt: (old && old.createdAt) || Date.now(), updatedAt: Date.now(), model, messages: msgs,
    ggb: (old && old.ggb) || null,
    cells: (old && old.cells) || [],
    figures: (old && old.figures) || [],
    figsIssued: (old && old.figsIssued) || [],
    mode: (old && old.mode) || null,
  };
  try { fs.writeFileSync(p, JSON.stringify(conv), "utf8"); } catch (e) { logErr("saveConv: " + e.message); }
}
const REVIEW_FILE = path.join(__dirname, "data", "review.json");
function readReview() { try { return JSON.parse(fs.readFileSync(REVIEW_FILE, "utf8")); } catch { return []; } }
function writeReview(list) { try { fs.mkdirSync(path.dirname(REVIEW_FILE), { recursive: true }); fs.writeFileSync(REVIEW_FILE, JSON.stringify(list.slice(0, 500)), "utf8"); } catch {} }
// riporta una voce vecchia (senza campi di ripetizione) allo schema SM-2
function revNorm(r) {
  if (typeof r.due !== "number") r.due = Number(r.t) || Date.now();
  if (typeof r.reps !== "number") r.reps = 0;
  if (typeof r.ease !== "number") r.ease = 2.5;
  if (typeof r.interval !== "number") r.interval = 0;
  if (typeof r.lapses !== "number") r.lapses = 0;
  return r;
}

// ---------- copie di sicurezza di data/ (chat, appunti, ripasso) ----------
const BACKUP_DIR = path.join(__dirname, "backups");
function runBackup() {
  try {
    fs.mkdirSync(BACKUP_DIR, { recursive: true });
    const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, "-");
    const name = "mathapp-" + stamp + ".zip";
    const dest = path.join(BACKUP_DIR, name);
    // Windows 10+ include bsdtar: zip diretto della cartella data/
    let r = spawnSync("tar", ["-a", "-c", "-f", dest, "-C", __dirname, "data"], { windowsHide: true });
    if (r.error || r.status !== 0 || !fs.existsSync(dest)) {
      r = spawnSync("powershell", ["-NoProfile", "-Command",
        "Compress-Archive -Path '" + path.join(__dirname, "data") + "' -DestinationPath '" + dest + "' -Force"], { windowsHide: true });
    }
    if (!fs.existsSync(dest)) return { ok: false, error: "archivio non creato" };
    // conserva solo gli ultimi 7 backup
    const files = fs.readdirSync(BACKUP_DIR).filter((f) => f.endsWith(".zip")).sort();
    while (files.length > 7) { try { fs.rmSync(path.join(BACKUP_DIR, files.shift()), { force: true }); } catch {} }
    return { ok: true, file: name, size: fs.statSync(dest).size };
  } catch (e) { logErr("backup: " + e.message); return { ok: false, error: String(e.message || e) }; }
}
function scheduleBackups() {
  if (SETTINGS.backup === false) return;
  const every = Number(SETTINGS.backupHours) > 0 ? Number(SETTINGS.backupHours) : 24;
  const timer = setInterval(runBackup, every * 3600 * 1000);
  if (timer.unref) timer.unref();
  // primo backup poco dopo l'avvio, senza rallentarlo
  const first = setTimeout(() => { runBackup(); }, 90 * 1000);
  if (first.unref) first.unref();
}

function listConvs() {
  const out = [];
  for (const f of fs.readdirSync(CONVDIR)) {
    if (!f.endsWith(".json")) continue;
    try {
      const c = JSON.parse(fs.readFileSync(path.join(CONVDIR, f), "utf8"));
      const nMsg = (c.messages || []).length, nCells = (c.cells || []).length, nFigs = (c.figures || []).length;
      if (!nMsg && !nCells && !nFigs) continue; // sessione vuota: non la mostro
      out.push({ id: c.id, title: c.title, updatedAt: c.updatedAt, count: nMsg, cells: nCells, figures: nFigs, hasGgb: !!c.ggb, mode: c.mode || null, tags: Array.isArray(c.tags) ? c.tags.filter((t) => typeof t === "string") : [] });
    } catch {}
  }
  return out.sort((a, b) => b.updatedAt - a.updatedAt);
}

// L'IA riceve sempre tutti gli strumenti e la regola "due letture" (algebrica + geometrica),
// in qualunque modalita' della UI.
// Istruzioni extra per le modalità didattiche
const SOCRATIC = `\n- MODALITA' "ESERCITAMI" ATTIVA — HA PRIORITA' SU TUTTE LE ALTRE REGOLE: NON risolvere il problema e NON mostrare lo svolgimento. La regola delle "due letture" NON si applica e non disegnare figure. Rispondi con UNA sola domanda di guida (o un piccolissimo indizio), breve, e fermati li'. Aspetta la risposta dello studente. Quando risponde, verifica il suo passaggio con sympy_compute e poi fai la domanda successiva. Se sbaglia, dai un indizio piu' preciso. Mostra la soluzione completa SOLO se te la chiede esplicitamente ("dammi la soluzione") o dopo 3 tentativi falliti.`;
const STEPWISE = `\n- MODALITA' "PASSO-PASSO" ATTIVA: struttura la risposta in passi numerati, ognuno con un titolo nel formato "### Passo N — <cosa fai>" seguito dal contenuto. Non anticipare i passi successivi: ogni passo deve reggersi da solo.`;

function toolsFor() {
  if (isFullMode()) return TOOLS;
  const disabled = new Set(["delega", "ricorda"]);
  return TOOLS.filter((t) => !(t && t.function && disabled.has(t.function.name)));
}

// Qualità tipografica delle formule: evita gli "obrobri" (tutto su una riga, *, apici...)
const LATEX_RULES = `
- SCRITTURA DELLE FORMULE (qualita' tipografica, importante):
  * NON usare "*" per moltiplicare: usa \\cdot oppure la giustapposizione (ab, non a*b).
  * Inverso: a^{-1} (non a'). La derivata invece si scrive f'(x) oppure \\frac{d}{dx}f(x).
  * Frazioni: \\frac{a}{b} · radici: \\sqrt{x} · limiti: \\lim_{x \\to 0} · integrali: \\int_a^b f(x)\\,dx.
  * NON affastellare piu' identita' su una riga con \\qquad: mettile in elenco, una per riga, oppure usa \\begin{aligned} ... \\\\ ... \\end{aligned}.
  * Una formula in blocco deve restare leggibile: se e' lunga, spezzala in piu' passaggi numerati.
  * Usa \\text{...} per le parole dentro le formule; evita catene di \\quad e \\qquad.
  * Esempio BRUTTO: $$(ab)c = a(bc), \\qquad ae = ea = a, \\qquad a*a' = a'*a = e.$$
  * Esempio BUONO (elenco):
    - proprieta' associativa: $(ab)c = a(bc)$
    - elemento neutro: $ae = ea = a$
    - inverso: $a\\,a^{-1} = a^{-1} a = e$`;

// Regole per la memoria di stile
const PROFILE_RULES = `\n- Tieni conto dello STILE dell'utente (te lo passo come messaggio di sistema, se ne conosci qualcuno). Se l'utente ti corregge sullo stile o esprime una preferenza stabile su come vuole le spiegazioni, registrala con il tool "ricorda" e rispettala da quel momento.`;

function systemFor(tutor, dark) {
  let s = SYSTEM + LATEX_RULES + PROFILE_RULES + levelRule();
  if (tutor === "socratic") s += SOCRATIC;
  if (tutor === "step") s += STEPWISE;
  if (dark) s += DARKBOARD;
  return s;
}

// La lavagna ha sfondo scuro: i colori di default (blu scuro/nero) non si vedono.
const DARKBOARD = `\n- ATTENZIONE: la lavagna GeoGebra ha SFONDO SCURO. Usa colori CHIARI e saturi per curve, punti, rette e testi (es. SetColor(f,90,160,255) azzurro, (255,200,80) giallo, (120,220,160) verde, (255,140,120) corallo). EVITA il nero e i blu scuri: sparirebbero. Metti sempre un SetColor esplicito sui tuoi oggetti e usa colori chiari anche per i Text(...).`;

// Regole per l'uso della rete concettuale (appunti/libri allegati)
const KB_RULES = `\n- ESTRATTI dagli appunti/libri DELL'UTENTE (te li passo come secondo messaggio di sistema; sono i documenti che ha allegato lui). REGOLE: (1) usali quando la sua domanda riguarda quel materiale, anche se il documento non e' allegato in questo preciso momento; (2) se la domanda e' su altro, IGNORALI del tutto e NON citarli; (3) quando li usi, cita la fonte in QUESTO formato esatto: [nome_file.pdf p.3]; (4) non inventare citazioni ne' riferimenti a materiale che non e' negli estratti.`;

// Spiegazione di un singolo calcolo del quaderno (riquadro "Spiega"):
// un solo stile, parole semplici alternate all'algebra.
const EXPLAIN_PROMPT = `Spieghi a uno studente i passaggi di un calcolo gia' risolto. Regole:
- Scrivi in italiano semplice e diretto, frasi brevi; alterna le parole alle formule: $...$ per le formule in linea, $$...$$ per i passaggi importanti.
- Parti dall'espressione data e arriva al risultato indicato: mostra SOLO i passaggi necessari. Non divagare, non rifare il calcolo con altri metodi, non aggiungere esercizi o teoria extra.
- Sii onesto: se un passaggio non e' ricavabile con una regola vera, salta direttamente al risultato. Mai inventare regole o passaggi falsi.
- NON scrivere il tuo ragionamento: niente frasi su cosa stai per fare, niente inglese. Scrivi solo la spiegazione finale, senza pensarci troppo a lungo.
- Al massimo ~12 righe. Niente titoli e niente introduzione: inizia subito dal primo passaggio.
- Notazione: \\cdot per moltiplicare (non *), \\frac per le frazioni, ^{...} per gli esponenti.`;

const MAX_DELEGHE = 2;

const SYSTEM = `Sei un tutor di matematica che risponde SEMPRE in italiano.
Regole:
- Scrivi le formule in LaTeX tra $ ... $ (inline) o $$ ... $$ (blocco).
- NON calcolare a mente: per ogni calcolo non banale usa il tool sympy_compute e riporta il risultato esatto che ottieni.
- Usa il tool geogebra SOLO quando c'e' una figura sensata da disegnare (funzioni, curve, rette, cerchi, punti, slider).
- Nel tool geogebra passa SOLO comandi GeoGebra validi e usa SEMPRE i nomi dei comandi in INGLESE (Circle, Text, SetColor, Max, Intersect, ...), anche se l'interfaccia è in italiano. Non passare MAI parole o frasi in linguaggio naturale: i comandi non validi vengono scartati.
- Il diagramma di Venn si puo' disegnare con Circle(...) e Text(...).
- Puoi anche MODIFICARE la geometria esistente col tool geogebra_edit (sposta punti con movePoint, cambia slider con setValue, colori, visibilita', avvia animazioni). Usalo quando l'utente chiede di muovere o cambiare qualcosa che e' gia' disegnato.
- REGOLA DUE LETTURE (importante): per OGNI richiesta, quando il concetto lo consente, dai SEMPRE due parti distinte, con questi titoli:
  (A) "Lettura algebrica" — definizione, simboli e formule in LaTeX, passaggi e calcoli esatti (usa sympy_compute).
  (B) "Lettura geometrica" — rappresentazione nell'applet con il tool geogebra (curva, retta, cerchio, punti, vettori, slider) e commento di cosa si vede.
  Se il concetto NON ha una rappresentazione geometrica sensata (es. teoria astratta, logica, combinatoria), scrivilo in una riga e ometti la parte B. Non saltare mai la parte A.
- Sviluppa le due letture in modo COMPLETO e discorsivo: definizioni, passaggi, il perche' delle cose, esempi. NON comprimerle in due righe: meglio una spiegazione lunga e chiara che un riassunto frettoloso.
- GEOGEBRA, REGOLE: (1) di norma UNA sola costruzione per figura, ma COMPLETA: funzione/curva + punti notevoli + ANNOTAZIONI con Text(...) per i valori importanti (zeri, vertice, asintoti, sup/inf) + colori con SetColor. (2) Crea piu' costruzioni solo se sono figure davvero distinte. (3) Dai sempre un titolo breve. (4) "mode": "add" per sovrapporre a una figura gia' presente (tangente, derivata), "replace" per una figura nuova. (5) La costruzione va SUBITO sul grafico: la scheda in chat resta per modificarla o rieseguirla.
- VISTA 3D: per geometria solida, superfici, funzioni di due variabili, piani, sfere e vettori nello spazio passa "view": "3d" al tool geogebra e usa comandi 3D in inglese (es. "A=(1,2,3)", "Sphere((0,0,0),2)", "Plane((1,0,0),(0,1,0),(0,0,1))", "f(x,y)=x^2-y^2", "Surface(u*cos(v),u*sin(v),u,u,0,2,v,0,6.28)"). La vista 3D ha assi x, y, z. Per tutto il resto usa la vista 2D (default).
- Se ti manca una capacita' o il compito e' molto difficile, puoi consultare un ALTRO modello con il tool "delega" (tipo: esperto | visione | lungo | verifica) e poi integrare la sua risposta nella tua. Usalo solo quando sympy_compute e geogebra non bastano.
- NON usare geogebra per concetti astratti senza rappresentazione grafica (es. teoria degli insiemi, logica, dimostrazioni): in quei casi basta testo + LaTeX.
- Teoria degli insiemi: usa sympy_compute con operation "evaluate" e notazione Python (unione: "{1,2,3} | {2,3,4}", intersezione: "... & ...", differenza: "... - ..."), oppure spiega a parole.
- STUDIO DI FUNZIONE: per il quadro completo usa sympy_compute con operation "studio" e expr "f(x)=x^2-3x+2" (accetta anche "y=..." o l'espressione nuda, es. "x^2-3x+2"). Ottieni un referto a sezioni (dominio, simmetrie, zeri, intersezione con l'asse y, segno, limiti, asintoti, derivate, monotonia, estremi, concavita', flessi) piu' i dati di disegno. Riassumi le voci importanti della richiesta invece di incollare tutto il referto; nel riquadro del calcolo l'utente ha i pulsanti "Disegna" (curva + punti notevoli + asintoti) e "Spiega".
- VETTORI E SPAZI VETTORIALI: usa sympy_compute con operation dot | cross | norm | angle | projection | independence | gram_schmidt e vectors = lista di vettori, es. "[[1,2],[3,4]]" (una lista per ogni vettore; cross solo in R^3; gram_schmidt richiede vettori linearmente indipendenti). Il riquadro del calcolo mostra i pulsanti "Disegna" 2D/3D quando i vettori sono 2D o 3D.
- Spiega in modo chiaro e graduale, come a lezione.
- METODO DIDATTICO: spiega il PERCHE' di ogni passaggio, non solo il come; richiama un prerequisito solo se serve; adatta lessico e formalismo al livello di dettaglio scelto; chiudi con una domanda di controllo breve quando aiuta davvero.
- CORREZIONE: se l'utente sbaglia, indica il punto esatto e il tipo di errore, poi guidalo a correggere; non limitarti a dare la soluzione.
- ONESTA': se non puoi verificare un risultato con sympy_compute o non sei sicuro, dillo; non inventare passaggi o teoremi.`;

const TOOLS = [
  {
    type: "function",
    function: {
      name: "sympy_compute",
      description: "Motore di calcolo simbolico ESATTO (SymPy). Usalo per derivate, integrali, limiti, equazioni, serie, semplificazioni, matrici, valutazioni numeriche, studio completo di funzione (operation \"studio\") e vettori (operation dot/cross/norm/angle/projection/independence/gram_schmidt con \"vectors\"). Restituisce risultato esatto + LaTeX.",
      parameters: {
        type: "object",
        properties: {
          operation: { type: "string", description: "simplify|diff|integrate|limit|series|expand|factor|apart|together|solve|dsolve|det|inverse|transpose|eigenvals|eigenvects|rank|rref|evaluate|latex|studio|dot|cross|norm|angle|projection|independence|gram_schmidt" },
          expr: { type: "string", description: "espressione o equazione, es. 'sin(x)/x' o 'x^2-3x+2=0'; per studio anche 'f(x)=x^2-3x+2'" },
          var: { type: "string", description: "variabile (default x)" },
          lower: { type: "string", description: "estremo inferiore per integrate definito" },
          upper: { type: "string", description: "estremo superiore per integrate definito" },
          point: { type: "string", description: "punto per limit/series, es. '0' o 'oo'" },
          order: { type: "integer", description: "ordine derivata/serie" },
          matrix: { type: "string", description: "matrice es. '[[1,2],[3,4]]'" },
          vectors: { type: "string", description: "vettori per dot/cross/norm/angle/projection/independence/gram_schmidt, es. '[[1,2],[3,4]]' (una lista per vettore)" },
          solve_for: { type: "string" },
          subs: { type: "object", description: "sostituzioni per evaluate, es. {\"x\":\"2\"}" },
        },
        required: ["operation"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "geogebra",
      description: "Disegna nell'applet GeoGebra dell'utente eseguendo comandi GeoGebra. Ogni chiamata crea una COSTRUZIONE separata, salvata nella chat e riproducibile in seguito: dagli un titolo breve. Usalo per funzioni, curve, punti, rette, cerchi, slider, animazioni.",
      parameters: {
        type: "object",
        properties: {
          title: { type: "string", description: "titolo breve della costruzione, es. 'parabola e zeri' (obbligatorio se possibile)" },
          mode: { type: "string", description: "'replace' = nuova figura che sostituisce quella sul grafico (default); 'add' = si sovrappone a quello che c'e' gia' (es. la tangente sopra la curva)" },
          view: { type: "string", description: "'3d' = vista tridimensionale (geometria solida, superfici, funzioni di due variabili); ometti o '2d' per il piano" },
          commands: { type: "array", items: { type: "string" }, description: "comandi GeoGebra in ordine, es. ['f(x)=sin(x)/x','A=(0,0)']" },
        },
        required: ["commands"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "delega",
      description: "Consulta un ALTRO modello specialista e ricevi la sua risposta, che poi integri nella tua risposta finale. Usalo quando ti manca una capacita', quando il compito e' molto difficile, o quando vuoi una verifica indipendente. Non usarlo se puoi risolvere con sympy_compute o geogebra.",
      parameters: {
        type: "object",
        properties: {
          tipo: { type: "string", description: "esperto (ragionamento difficile) | visione (immagini) | lungo (testo molto lungo) | verifica (secondo parere su un risultato)" },
          richiesta: { type: "string", description: "la domanda precisa da porre allo specialista" },
          contesto: { type: "string", description: "contesto essenziale da passare (facoltativo)" },
        },
        required: ["tipo", "richiesta"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "ricorda",
      description: "Registra una preferenza STABILE dell'utente su COME vuole le risposte (stile, formato, quanti esempi, livello di dettaglio, tono, cosa evitare). Usalo quando ti corregge sullo stile o esprime un gusto ricorrente. NON inserire esempi, formule o riferimenti a contenuti specifici: scrivi solo la regola generale (es. 'preferisce molti esempi concreti prima della teoria'). NON registrare contenuti di esercizi, dati temporanei o il tema del momento.",
      parameters: {
        type: "object",
        properties: {
          testo: { type: "string", description: "la preferenza in una riga, in terza persona (es. 'preferisce molti esempi concreti prima della teoria' oppure 'vuole sempre la verifica con SymPy')" },
        },
        required: ["testo"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "geogebra_edit",
      description: "Modifica geometria GIA' presente nell'applet GeoGebra: sposta punti, cambia il valore di slider/variabili, colori, visibilita', etichette, spessori, elimina oggetti, avvia/ferma animazioni. Usalo quando l'utente chiede di MUOVERE o CAMBIARE qualcosa (non per creare).",
      parameters: {
        type: "object",
        properties: {
          ops: {
            type: "array",
            description: "Lista di operazioni da eseguire in ordine",
            items: {
              type: "object",
              properties: {
                op: { type: "string", description: "movePoint|setValue|setColor|setVisible|setCaption|setLineThickness|setAnimating|startAnimation|stopAnimation|delete" },
                name: { type: "string", description: "nome dell'oggetto (es. 'A', 'f', 'a')" },
                x: { type: "number" }, y: { type: "number" },
                value: { type: "number" },
                r: { type: "integer" }, g: { type: "integer" }, b: { type: "integer" },
                visible: { type: "boolean" },
                text: { type: "string" },
                thickness: { type: "number" },
                on: { type: "boolean" },
              },
              required: ["op"],
            },
          },
        },
        required: ["ops"],
      },
    },
  },
];

// ---------- static ----------
const MIME = { ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8", ".json": "application/json" };
function serveStatic(res, urlPath) {
  let rel = urlPath === "/" ? "/index.html" : urlPath;
  const file = path.join(PUBLIC, path.normalize(rel).replace(/^([/\\])+/, ""));
  if (file !== PUBLIC && !file.startsWith(PUBLIC + path.sep)) { res.writeHead(403); return res.end("forbidden"); }
  fs.readFile(file, (err, data) => {
    if (err) { res.writeHead(404); return res.end("not found"); }
    res.writeHead(200, { "Content-Type": MIME[path.extname(file)] || "application/octet-stream", "Cache-Control": "no-cache" });
    res.end(data);
  });
}

// ---------- tools ----------
const SYMPY_TIMEOUT_MS = Math.max(1, Math.min(120000, Number(process.env.MATHAPP_SYMPY_TIMEOUT_MS) || 20000));
const SYMPY_MAX_OUTPUT_BYTES = 2 * 1024 * 1024;
const SYMPY_MAX_CONCURRENCY = 2;
let sympyProcesses = 0;

function runSympy(args) {
  if (sympyProcesses >= SYMPY_MAX_CONCURRENCY) {
    return Promise.resolve({ ok: false, error: "sympy_cli: calcolatore occupato, riprova tra poco" });
  }
  sympyProcesses++;
  return new Promise((resolve) => {
    let out = "", err = "", outBytes = 0, settled = false, timer;
    const finish = (value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      sympyProcesses = Math.max(0, sympyProcesses - 1);
      resolve(value);
    };
    let p;
    try {
      p = spawn("python", [SYMPY_CLI, JSON.stringify(args)], { windowsHide: true, env: PY_ENV });
    } catch (e) {
      finish({ ok: false, error: "spawn sympy_cli fallito: " + e.message });
      return;
    }
    timer = setTimeout(() => {
      try { p.kill(); } catch {}
      finish({ ok: false, error: "sympy_cli: tempo limite superato" });
    }, SYMPY_TIMEOUT_MS);
    p.stdout.on("data", (d) => {
      if (settled) return;
      outBytes += d.length;
      if (outBytes > SYMPY_MAX_OUTPUT_BYTES) {
        try { p.kill(); } catch {}
        finish({ ok: false, error: "sympy_cli: risultato supera il limite di dimensione" });
        return;
      }
      out += d.toString("utf8");
    });
    p.stderr.on("data", (d) => { if (!settled && err.length < 8192) err += d.toString("utf8").slice(0, 8192 - err.length); });
    p.on("close", () => {
      if (settled) return;
      try { finish(JSON.parse(out.trim())); }
      catch { finish({ ok: false, error: "sympy_cli: risposta non valida", raw: out.slice(0, 400), stderr: err.slice(0, 300) }); }
    });
    p.on("error", (e) => finish({ ok: false, error: "spawn sympy_cli fallito: " + e.message }));
  });
}

const ggbPending = new Map(); // callId -> resolve
// Windows: forzare UTF-8 nei processi Python figli (altrimenti cp1252 rompe ●, ², accenti…)
const PY_ENV = { ...process.env, PYTHONUTF8: "1", PYTHONIOENCODING: "utf-8" };
const pdfCache = new Map();   // sha1(b64) -> testo estratto

function runPdf(b64) {
  return new Promise((resolve) => {
    const p = spawn("python", [EXTRACT_PY], { windowsHide: true, env: PY_ENV });
    let out = "", err = "";
    p.stdout.on("data", (d) => (out += d));
    p.stderr.on("data", (d) => (err += d));
    p.on("close", () => {
      const line = out.trim().split("\n").filter(Boolean).pop() || "";
      try { resolve(JSON.parse(line)); }
      catch { resolve({ ok: false, error: "uscita non valida: " + out.slice(-160) + " " + err.slice(-120) }); }
    });
    p.on("error", () => resolve({ ok: false, error: "impossibile avviare l'estrazione PDF" }));
    try { p.stdin.write(b64); p.stdin.end(); } catch { resolve({ ok: false, error: "invio PDF fallito" }); }
  });
}

async function docToText(name, mime, b64) {
  if (String(mime).includes("pdf")) {
    const key = crypto.createHash("sha1").update(b64).digest("hex");
    if (pdfCache.has(key)) return pdfCache.get(key);
    const r = await runPdf(b64);
    cachePut(pdfCache, key, r);
    return r;
  }
  try { return { ok: true, text: Buffer.from(b64, "base64").toString("utf8").replace(/^\uFEFF/, "") }; }
  catch { return { ok: false, error: "file non decodificabile come testo" }; }
}

const audioCache = new Map(); // sha1(b64) -> risultato trascrizione
const isAudio = (name, mime) => String(mime || "").startsWith("audio/") || AUDIO_EXT.test(String(name || ""));

// Il modello Whisper resta caldo in un processo dedicato: si carica una volta
// sola e le richieste successive non pagano piu' il caricamento (4-5 s).
let whisperWorker = null;
let whisperQueue = Promise.resolve();

function whisperSettle(worker, value) {
  const pending = worker.pending;
  if (!pending) return;
  worker.pending = null;
  clearTimeout(pending.timer);
  pending.resolve(value);
}

function whisperStop(worker) {
  clearTimeout(worker.idleTimer);
  worker.idleTimer = null;
  if (whisperWorker === worker) whisperWorker = null;
  try { worker.proc.stdin.write(JSON.stringify({ cmd: "exit" }) + "\n"); } catch {}
  try { worker.proc.kill(); } catch {}
  whisperSettle(worker, { ok: false, error: "trascrizione interrotta" });
}

function getWhisperWorker() {
  if (whisperWorker && whisperWorker.proc.exitCode === null && !whisperWorker.proc.killed) return whisperWorker;
  const proc = spawn("python", [TRANSCRIBE_PY, "--worker", WHISPER_MODEL, WHISPER_LANG], { windowsHide: true, env: PY_ENV, stdio: ["pipe", "pipe", "pipe"] });
  const worker = { proc, buf: "", errTail: "", pending: null, idleTimer: null, seq: 0 };
  proc.stdout.on("data", (d) => {
    worker.buf += d.toString("utf8");
    let i;
    while ((i = worker.buf.indexOf("\n")) >= 0) {
      const line = worker.buf.slice(0, i).trim();
      worker.buf = worker.buf.slice(i + 1);
      if (!line) continue;
      let msg = null;
      try { msg = JSON.parse(line); } catch { continue; }
      if (msg.ready) {
        logErr(`whisper worker pronto: modello ${msg.model}, lingua ${msg.language}`);
        // se nessuna richiesta è in coda, il modello resta caldo per WHISPER_IDLE_MS
        if (!worker.pending) {
          clearTimeout(worker.idleTimer);
          worker.idleTimer = setTimeout(() => whisperStop(worker), WHISPER_IDLE_MS);
        }
        continue;
      }
      whisperSettle(worker, msg);
    }
  });
  proc.stderr.on("data", (d) => { worker.errTail = (worker.errTail + d.toString("utf8")).slice(-2000); });
  proc.on("error", (e) => { whisperSettle(worker, { ok: false, error: "impossibile avviare faster-whisper: " + e.message }); });
  proc.on("exit", () => {
    clearTimeout(worker.idleTimer);
    worker.idleTimer = null;
    if (whisperWorker === worker) whisperWorker = null;
    whisperSettle(worker, { ok: false, error: "processo Whisper terminato" + (worker.errTail ? ": " + worker.errTail.slice(-300) : "") });
  });
  whisperWorker = worker;
  return worker;
}

function runWhisper(b64) {
  const run = whisperQueue.catch(() => {}).then(() => new Promise((resolve) => {
    const worker = getWhisperWorker();
    if (worker.pending) { resolve({ ok: false, error: "trascrizione già in corso" }); return; }
    clearTimeout(worker.idleTimer);
    worker.idleTimer = null;
    const id = ++worker.seq;
    const timer = setTimeout(() => {
      worker.pending = null; // evita che whisperStop risolva con un altro messaggio
      whisperStop(worker);
      resolve({ ok: false, error: "trascrizione: tempo limite superato" });
    }, WHISPER_TIMEOUT_MS);
    worker.pending = { id, timer, resolve };
    try {
      worker.proc.stdin.write(JSON.stringify({ id, b64 }) + "\n");
    } catch (e) {
      clearTimeout(timer);
      worker.pending = null;
      resolve({ ok: false, error: "invio audio fallito: " + e.message });
    }
  }));
  whisperQueue = run.then((r) => {
    const worker = whisperWorker;
    if (worker && !worker.pending && !worker.proc.killed) {
      clearTimeout(worker.idleTimer);
      worker.idleTimer = setTimeout(() => whisperStop(worker), WHISPER_IDLE_MS);
    }
    return r;
  }, () => {});
  return run;
}

// Scaldare il modello quando si apre l'app: la prima dettatura non paga il caricamento.
let whisperPreloadAt = 0;
function maybePreloadWhisper() {
  if (process.env.MATHAPP_NO_WHISPER === "1") return;
  if (Date.now() - whisperPreloadAt < 5 * 60 * 1000) return; // niente tentativi a raffica
  whisperPreloadAt = Date.now();
  try { getWhisperWorker(); } catch (e) { logErr("preload whisper: " + e.message); }
}

async function audioToText(b64) {
  const key = crypto.createHash("sha1").update(b64).digest("hex");
  if (audioCache.has(key)) return audioCache.get(key);
  const t = await runWhisper(b64);
  cachePut(audioCache, key, t);
  return t;
}

// Trasforma i messaggi del client in messaggi per il modello, con gli allegati.
// Ritorna { msgs, notices } — le notices vengono mostrate all'utente in chat.
async function buildUpstream(rawMsgs) {
  const out = [];
  const notices = [];
  const collected = []; // materiale per la rete concettuale
  for (const m of rawMsgs) {
    const atts = m.role === "user" && Array.isArray(m.attachments) ? m.attachments.slice(0, 4) : [];
    if (!atts.length) { out.push({ role: m.role, content: m.content }); continue; }
    const images = [];
    const docs = [];
    for (const a of atts) {
      const mime = String(a.mime || "");
      if (isAudio(a.name, mime)) {
        const t = await audioToText(a.b64);
        if (t && t.ok && t.text) {
          const conf = Math.round((t.language_probability || 0) * 100);
          docs.push(`### Trascrizione audio: ${a.name}\n(lingua ${t.language}, confidenza ${conf}%, durata ${t.duration}s, Whisper ${t.model})\n\`\`\`\n${String(t.text).slice(0, 40000)}\n\`\`\``);
          notices.push(`Audio «${a.name}» trascritto in locale (Whisper ${t.model}): lingua ${t.language} ${conf}%, ${t.duration}s.`);
          collected.push({ name: a.name, kind: "audio", text: String(t.text), b64: a.b64, mime });
        } else {
          notices.push(`Trascrizione di «${a.name}» non riuscita: ${(t && t.error) || "errore"}.`);
        }
      } else if (mime.startsWith("image/")) {
        images.push({ type: "image_url", image_url: { url: `data:${mime};base64,${a.b64}` } });
      } else {
        const t = await docToText(a.name, mime, a.b64);
        if (t && t.ok) {
          docs.push(`### Allegato: ${a.name}\n\`\`\`\n${String(t.text || "").slice(0, 60000)}\n\`\`\``);
          notices.push(`Allegato «${a.name}» letto (${String(t.text || "").length} caratteri).`);
          collected.push({ name: a.name, kind: String(mime).includes("pdf") ? "pdf" : "testo", text: String(t.text || ""), b64: a.b64, mime });
        } else {
          notices.push(`Allegato «${a.name}» non leggibile: ${(t && t.error) || "errore"}.`);
        }
      }
    }
    let text = m.content || "";
    if (docs.length) text += "\n\n" + docs.join("\n\n");
    out.push(images.length ? { role: "user", content: [{ type: "text", text }, ...images] } : { role: "user", content: text });
  }
  return { msgs: out, notices, collected };
}
function runGGB(send, commands, title, mode, convId, view, signal) {
  if (signal && signal.aborted) return Promise.resolve({ error: "richiesta annullata" });
  const callId = crypto.randomUUID();
  const fid = crypto.randomUUID(); // il server EMETTE la costruzione: solo queste verranno accettate
  const md = mode === "add" ? "add" : "replace";
  const vw = view === "3d" ? "3d" : "2d";
  send("geogebra", { callId, fid, commands, title: title || "", mode: md, view: vw });
  if (convId) {
    try {
      const p = convFile(convId);
      let c = null; try { c = JSON.parse(fs.readFileSync(p, "utf8")); } catch {}
      if (!c) c = { id: convId, title: "Nuova chat", createdAt: Date.now(), messages: [], figures: [], cells: [], ggb: null };
      c.figsIssued = Array.isArray(c.figsIssued) ? c.figsIssued : [];
      if (!c.figsIssued.includes(fid)) c.figsIssued.push(fid);
      c.figsIssued = c.figsIssued.slice(-200);
      fs.writeFileSync(p, JSON.stringify(c), "utf8");
    } catch (e) { logErr("figsIssued: " + e.message); }
  }
  return new Promise((resolve) => {
    let t = null;
    const cleanup = () => {
      if (t) clearTimeout(t);
      ggbPending.delete(callId);
      if (signal) signal.removeEventListener("abort", onAbort);
    };
    const finish = (value) => { cleanup(); resolve(value); };
    const onAbort = () => finish({ error: "richiesta annullata" });
    ggbPending.set(callId, finish);
    t = setTimeout(() => finish({ note: "nessuna conferma dal browser (timeout 12s)" }), 12000);
    if (signal) {
      signal.addEventListener("abort", onAbort, { once: true });
      if (signal.aborted) onAbort();
    }
  });
}

function runGGBEdit(send, ops, signal) {
  if (signal && signal.aborted) return Promise.resolve({ error: "richiesta annullata" });
  const callId = crypto.randomUUID();
  send("geogebra_edit", { callId, ops });
  return new Promise((resolve) => {
    let t = null;
    const cleanup = () => {
      if (t) clearTimeout(t);
      ggbPending.delete(callId);
      if (signal) signal.removeEventListener("abort", onAbort);
    };
    const finish = (value) => { cleanup(); resolve(value); };
    const onAbort = () => finish({ error: "richiesta annullata" });
    ggbPending.set(callId, finish);
    t = setTimeout(() => finish({ note: "nessuna conferma dal browser (timeout 10s)" }), 10000);
    if (signal) {
      signal.addEventListener("abort", onAbort, { once: true });
      if (signal.aborted) onAbort();
    }
  });
}

// "Strumento visione": fa trascrivere le immagini da un modello che le vede,
// così anche i modelli solo-testo possono usarle.
// ---------- SSE upstream parse ----------
// cache con tetto: evita crescita illimitata in sessioni lunghe
const cachePut = (map, key, val, max = 24) => { if (!map.has(key) && map.size >= max) map.clear(); map.set(key, val); return val; };

async function runDelega(args, send, primary, signal) {
  const richiesta = String(args.richiesta || "").trim();
  if (!richiesta) return { error: "richiesta vuota" };
  const tipo = String(args.tipo || "esperto").toLowerCase();
  const model = pickSpecialist(tipo, primary);
  const ctx = String(args.contesto || "").slice(0, 4000);
  send("notice", { text: `Delega a «${model}» (${tipo}): ${richiesta.slice(0, 110)}` });
  try {
    const r = await callModel(model, [
      { role: "system", content: "Sei uno specialista consultato da un altro assistente. Rispondi in italiano, preciso e conciso (max ~250 parole), con LaTeX dove serve. Non ripetere la domanda, dai direttamente la soluzione o il parere." },
      { role: "user", content: ctx ? `${richiesta}\n\nContesto:\n${ctx}` : richiesta },
    ], { maxTokens: 1200, sessionId: "delega-" + tipo, signal });
    send("notice", { text: `«${model}» ha risposto (${(r.text || "").length} caratteri): il modello principale la integrerà.` });
    return { specialista: model, tipo, risposta: r.text || "(nessuna risposta)" };
  } catch (e) {
    if (signal && signal.aborted) throw e;
    logErr("delega: " + e.message);
    return { error: `delega a ${model} fallita: ${e.message}` };
  }
}

// escalation a catena (cap 3) se il modello scelto non è disponibile
async function streamWithEscalation(sessionId, payloadObj, send, model, signal) {
  const ladder = [model, ...MODELS.filter((m) => m !== model)];
  let lastErr;
  for (let i = 0; i < Math.min(3, ladder.length); i++) {
    if (signal && signal.aborted) throw new Error("richiesta annullata dal client");
    const m = ladder[i];
    let got = false;
    try {
      const acc = await streamUpstream({ sessionId, payload: { ...payloadObj, model: m } }, (ev, d) => { if (ev === "delta") got = true; send(ev, d); }, signal);
      if (i > 0) send("notice", { text: `Risposta prodotta da «${m}»: il modello scelto («${model}») non era disponibile.` });
      return acc;
    } catch (e) {
      if (signal && signal.aborted) throw e;
      lastErr = e;
      logErr(`escalation ${m}: ${e.message.slice(0, 150)}`);
      if (got) throw e;
      if (i < 2 && ladder[i + 1]) send("notice", { text: `«${m}» non ha risposto (${e.message.slice(0, 90)}). Passo a «${ladder[i + 1]}».` });
    }
  }
  throw lastErr;
}

// ---------- rete concettuale (appunti/libri allegati) ----------
const KB_DIR = path.join(__dirname, "data", "kb");
const KB_INDEX = path.join(KB_DIR, "index.json");
const KB_CHUNKS = path.join(KB_DIR, "chunks.json");
const STOP = new Set(["della", "delle", "dello", "degli", "questo", "questa", "questi", "queste", "sono", "essere", "avere", "come", "anche", "perche", "quando", "dove", "quale", "quali", "tutto", "tutti", "molto", "poco", "the", "and", "for", "with", "that", "this", "from", "una", "uno", "gli", "dei", "che", "non", "per", "con", "tra", "fra", "sul", "sui", "nel", "nei", "alla", "allo", "agli", "essere", "fare", "piu", "meno", "solo", "ogni", "sua", "suo", "suoi", "sue",
  // parole-istruzione e interrogativi: NON sono contenuto
  "quanto", "quanti", "quante", "cosa", "chi", "cita", "citami", "dimmi", "spiega", "spiegami", "elenca", "calcola", "risolvi", "trova", "mostra", "fammi", "vorrei", "puoi", "sapresti", "riguarda", "parla", "dice", "contiene", "miei", "mio", "mia", "appunti", "appunto", "libro", "libri", "pdf", "file", "documento", "allegato", "allegati", "breve", "righe", "riga", "punto", "punti", "sopra", "sotto", "quindi", "allora", "dopo", "prima"]);

function kbLoad() { try { return JSON.parse(fs.readFileSync(KB_INDEX, "utf8")); } catch { return { docs: [] }; } }
function kbSave(idx) { try { fs.mkdirSync(KB_DIR, { recursive: true }); fs.writeFileSync(KB_INDEX, JSON.stringify(idx), "utf8"); } catch (e) { logErr("kbSave: " + e.message); } }
function kbChunks() { try { return JSON.parse(fs.readFileSync(KB_CHUNKS, "utf8")); } catch { return []; } }
function kbChunksSave(list) { try { fs.mkdirSync(KB_DIR, { recursive: true }); fs.writeFileSync(KB_CHUNKS, JSON.stringify(list.slice(-5000)), "utf8"); } catch (e) { logErr("kbChunksSave: " + e.message); } }

// normalizzazione leggera dell'italiano: "limite"/"limiti" -> "limit", "notevole"/"notevoli" -> "notevol"
function stem(w) {
  let x = String(w);
  if (x.length <= 4) return x;
  x = x.replace(/(zione|zioni|mente|ita|ivi|iva|ive|ivo|ali|ale|osi|oso|osa|ose|ici|ica|ico|iche|logie|logia)$/, "");
  x = x.replace(/[aeio]$/, "");
  return x.length >= 3 ? x : w;
}

function tokenize(s) {
  return String(s || "").toLowerCase().replace(/[^\p{L}\p{N}\s]/gu, " ").split(/\s+/)
    .filter((w) => w.length > 3 && !STOP.has(w))
    .map(stem);
}

function chunkText(text) {
  const out = [];
  const raw = String(text || "");
  const parts = raw.split(/---\s*pagina\s*(\d+)\s*---/i);
  const segs = [];
  if (parts.length > 1) for (let i = 1; i < parts.length; i += 2) segs.push({ page: parseInt(parts[i], 10), text: parts[i + 1] || "" });
  else segs.push({ page: null, text: raw });
  for (const s of segs) {
    const paras = s.text.split(/\n\s*\n/).map((x) => x.trim()).filter(Boolean);
    let buf = "";
    for (const p of paras) {
      if (buf && (buf.length + p.length) > 1000) { out.push({ page: s.page, text: buf.trim() }); buf = p; }
      else buf = buf ? buf + "\n" + p : p;
    }
    if (buf.trim()) out.push({ page: s.page, text: buf.trim() });
  }
  return out.slice(0, 400);
}

// collega un documento alla conversazione corrente (può essere in uso in più chat)
function kbUse(id, convId) {
  const idx = kbLoad();
  const doc = idx.docs.find((d) => d.id === id);
  if (!doc) return false;
  doc.convIds = Array.isArray(doc.convIds) ? doc.convIds : (doc.convId ? [doc.convId] : []);
  if (convId && !doc.convIds.includes(convId)) doc.convIds.push(convId);
  doc.convIds = doc.convIds.slice(-50);
  if (convId) doc.convId = convId;
  kbSave(idx);
  return true;
}
function kbInConv(doc, convId) {
  if (!convId) return false;
  if (doc.convId === convId) return true;
  return Array.isArray(doc.convIds) && doc.convIds.includes(convId);
}

// salva un allegato nella rete concettuale: il FILE originale + il testo indicizzato
function kbAdd(name, kind, text, convId, b64, mime) {
  const body = String(text || "").trim();
  const id = crypto.createHash("sha1").update(body || String(name) + Date.now()).digest("hex").slice(0, 12);
  const idx = kbLoad();
  const esistente = idx.docs.find((d) => d.id === id);
  if (esistente) { kbUse(id, convId); return kbLoad().docs.find((d) => d.id === id); }

  // 1) salvo il file originale su disco
  let file = null;
  try {
    const ext = (String(name).match(/\.[a-z0-9]+$/i) || [""])[0].toLowerCase();
    const dir = path.join(KB_DIR, "files");
    fs.mkdirSync(dir, { recursive: true });
    const fp = path.join(dir, id + ext);
    const buf = Buffer.from(String(b64 || ""), "base64");
    if (buf.length) { fs.writeFileSync(fp, buf); file = { path: fp, name, ext, size: buf.length, mime: mime || "application/octet-stream" }; }
  } catch (e) { logErr("kbAdd file: " + e.message); }

  // 2) indicizzo il testo (se disponibile)
  const chunks = body.length >= 40 ? chunkText(body) : [];
  if (!chunks.length && !file) return null;

  const doc = { id, name, kind, convId: convId || null, addedAt: Date.now(), chars: body.length, chunks: chunks.length, file };
  idx.docs.unshift(doc);
  kbSave(idx);
  if (chunks.length) {
    const all = kbChunks();
    chunks.forEach((c, i) => all.push({ docId: id, docName: name, kind, page: c.page, i, text: c.text }));
    kbChunksSave(all);
  }
  return doc;
}

// ricerca "BM25-lite" sui blocchi.
// - cerca in TUTTA la rete (sono i documenti che l'utente ha allegato)
// - se la domanda NOMINA un documento ("i miei appunti di analisi"), quel documento viene rinforzato
// - richiede un punteggio minimo: niente citazioni a caso
function kbSearch(query, k = 4) {
  const chunks = kbChunks();
  if (!chunks.length) return [];
  const terms = [...new Set(tokenize(query))];
  if (terms.length < 1) return [];

  const N = chunks.length;
  const df = {};
  const toks = chunks.map((c) => { const t = tokenize(c.text); return { c, t, set: new Set(t) }; });
  for (const { set } of toks) for (const w of terms) if (set.has(w)) df[w] = (df[w] || 0) + 1;

  const scored = [];
  for (const { c, t } of toks) {
    const tf = {};
    for (const w of t) if (terms.includes(w)) tf[w] = (tf[w] || 0) + 1;
    let s = 0, match = 0;
    for (const w of terms) {
      if (!tf[w]) continue;
      match++;
      const idf = Math.log(1 + N / (1 + (df[w] || 0)));
      s += (tf[w] / (tf[w] + 1.5)) * idf;
    }
    // rinforzo: la domanda nomina il documento (es. "analisi" -> analisi.pdf)
    const nome = String(c.docName || "").toLowerCase();
    for (const w of terms) {
      if (w.length >= 5 && nome.includes(w.slice(0, w.length - 1))) { s += 1.2; match = Math.max(match, 1); break; }
    }
    if (match >= 1 && s >= 0.8) scored.push({ s, match, c });
  }
  scored.sort((a, b) => b.s - a.s);

  const perDoc = {};
  const out = [];
  for (const { c } of scored) {
    perDoc[c.docId] = (perDoc[c.docId] || 0) + 1;
    if (perDoc[c.docId] > 2) continue;
    out.push(c);
    if (out.length >= k) break;
  }
  return out;
}

// ---------- memoria di stile dell'utente ----------
const PROFILE_FILE = path.join(__dirname, "data", "profile.json");
function profLoad() { try { const j = JSON.parse(fs.readFileSync(PROFILE_FILE, "utf8")); return Array.isArray(j) ? j : []; } catch { return []; } }
function profSave(list) { try { fs.mkdirSync(path.dirname(PROFILE_FILE), { recursive: true }); fs.writeFileSync(PROFILE_FILE, JSON.stringify(list.slice(0, 200)), "utf8"); } catch (e) { logErr("profSave: " + e.message); } }

function profAdd(testo, source) {
  const raw = String(testo || "").replace(/\s+/g, " ").trim();
  // Contenuti da rifiutare: formule, oppure "esempio:" seguito da roba concreta.
  // (una preferenza tipo "vuole molti esempi concreti" invece e' legittima)
  const contenuto = /[\\$]|sin\s*\(|cos\s*\(|tan\s*\(|log\s*\(|ln\s*\(|lim\s|\bfrac\b|sqrt|\(es\.|\(ad es\.|\(per esempio/i.test(raw)
    || /\b(esempio|esempi)\s*[:=]/i.test(raw);
  if (contenuto) {
    logErr("profAdd rifiutata (contiene esempi/formule): " + raw.slice(0, 90));
    return null;
  }
  const t = raw.slice(0, 300);
  if (t.length < 12) return null;
  const list = profLoad();
  const norm = t.toLowerCase().replace(/[^\p{L}\p{N} ]/gu, "");
  const dup = list.find((c) => c.norm === norm || (c.testo || "").toLowerCase().replace(/[^\p{L}\p{N} ]/gu, "") === norm);
  if (dup) { dup.t = Date.now(); return dup; }
  const clue = { id: crypto.randomUUID(), testo: t, norm, t: Date.now(), hits: 0, source: source || "manuale" };
  list.unshift(clue);
  profSave(list);
  return clue;
}

function profForPrompt() {
  if (!isFullMode()) return [];
  const list = profLoad().slice(0, 30);
  for (const c of list) c.hits = (c.hits || 0) + 1;
  profSave(profLoad().map((c) => { const f = list.find((x) => x.id === c.id); return f ? { ...c, hits: f.hits } : c; }));
  return list;
}

// ---------- agent loop ----------
async function runAgent(payload, sessionId, send, mode, isGone, signal) {
  const cancelled = () => !!(signal && signal.aborted) || !!(isGone && isGone());
const sysBase = systemFor(payload.__tutor, payload.__dark) + (isFullMode() && payload.__kb && payload.__kb.length ? KB_RULES : "");
  const messages = [{ role: "system", content: sysBase }, ...payload];
  if (isFullMode() && payload.__kb && payload.__kb.length) {
    const estratti = payload.__kb.map((c) => "[" + c.docName + (c.page ? " p." + c.page : "") + "]\n" + c.text).join("\n\n---\n\n");
    messages.splice(1, 0, { role: "system", content: "ESTRATTI DAGLI APPUNTI/LIBRI DELL'UTENTE:\n\n" + estratti });
  }
  if (payload.__profile && payload.__profile.length) {
    const stile = payload.__profile.map((c) => "- " + c.testo).join("\n");
    messages.splice(1, 0, { role: "system", content: "STILE E PREFERENZE DELL'UTENTE, imparate nel tempo. HANNO PRIORITA' SU TUTTE LE REGOLE GENERALI QUI SOPRA (compresa la regola delle 'due letture' e l'uso di GeoGebra). Applicale IN SILENZIO: non menzionarle, non alludervi, non farne esempi, non parlarne. Se una preferenza non e' pertinente a quello che l'utente sta chiedendo, ignorala senza commentarla.\n" + stile });
  }
  let last = "";
  let deleghe = 0;
  const usage = { prompt: 0, completion: 0, total: 0 };
  const used = { sympy: 0, geogebra: 0 };
  const sendVerification = () => send("verification", { sympy: used.sympy, geogebra: used.geogebra });
  const sendUsage = () => { if (usage.total) send("usage", usage); };
  for (let step = 0; step < 8; step++) {
    if (cancelled()) { logErr("chat interrotta dal client: stop del lavoro lato server"); return last; }
    const acc = await streamWithEscalation(sessionId, { model: payload.__model || MODELS[0], messages, tools: toolsFor(mode), tool_choice: "auto", stream: true }, send, payload.__model || MODELS[0], signal);
    if (cancelled()) return last;
    if (acc.usage) {
      usage.prompt += acc.usage.prompt_tokens || 0;
      usage.completion += acc.usage.completion_tokens || 0;
      usage.total += acc.usage.total_tokens || 0;
    }
    const asst = { role: "assistant", content: acc.content || "" };
    if (acc.toolCalls.length) asst.tool_calls = acc.toolCalls.map((t) => ({ id: t.id, type: "function", function: { name: t.name, arguments: t.args } }));
    messages.push(asst);
    if (acc.content) last = acc.content;

    if (!acc.toolCalls.length) { sendUsage(); sendVerification(); send("done", {}); return acc.content; }

    for (const tc of acc.toolCalls) {
      if (cancelled()) return last;
      let args = {};
      try { args = JSON.parse(tc.args || "{}"); } catch { args = {}; }
      send("tool", { name: tc.name, args });
      let result;
      if (tc.name === "sympy_compute") { used.sympy++; result = await runSympy(args); if (cancelled()) return last; send("sympy_result", { args, result }); }
      else if (tc.name === "geogebra") { used.geogebra++; result = await runGGB(send, args.commands || [], args.title, args.mode, payload.__conv, args.view, signal); }
      else if (tc.name === "delega") {
        if (deleghe >= MAX_DELEGHE) result = { error: `limite di ${MAX_DELEGHE} deleghe raggiunto: procedi con quello che hai.` };
        else { deleghe++; result = await runDelega(args, send, payload.__model, signal); }
      }
      else if (tc.name === "ricorda") {
        const c = profAdd(args.testo, "IA");
        if (c) send("notice", { text: "ðŸ§  imparato sul tuo stile: " + c.testo });
        result = c ? { ok: true, registrato: c.testo } : { error: "preferenza vuota o troppo corta" };
      }
      else if (tc.name === "geogebra_edit") { used.geogebra++; result = await runGGBEdit(send, args.ops || [], signal); }
      else result = { error: "tool sconosciuto: " + tc.name };
      if (cancelled()) return last;
      const capTool = result && (result.kind === "studio" || result.kind === "vettori") ? 9000 : 4000;
      messages.push({ role: "tool", tool_call_id: tc.id, content: JSON.stringify(result).slice(0, capTool) });
    }
  }
  sendUsage();
  sendVerification();
  send("done", {});
  return last;
}

// ---------- http ----------
const server = http.createServer((req, res) => {
  const url = new URL(req.url, "http://127.0.0.1");
  // CSRF: le richieste con effetti da un altro sito vengono rifiutate.
  // I client non-browser (curl, test) non mandano Origin e passano.
  if (req.method !== "GET" && req.method !== "HEAD") {
    const origin = req.headers.origin;
    if (origin) {
      let okOrigin = false;
      try { okOrigin = new URL(origin).host === req.headers.host; } catch {}
      if (!okOrigin) { res.writeHead(403, { "Content-Type": "text/plain; charset=utf-8" }); return res.end("origine non consentita"); }
    }
    const cl = Number(req.headers["content-length"] || 0);
    if (cl > MAX_BODY) { res.writeHead(413, { "Content-Type": "text/plain; charset=utf-8" }); return res.end("richiesta troppo grande"); }
    let seen = 0, tooBig = false;
    req.on("data", (c) => {
      if (tooBig) return;
      seen += c.length;
      if (seen > MAX_BODY) {
        tooBig = true;
        try { res.writeHead(413, { "Content-Type": "text/plain; charset=utf-8" }); res.end("richiesta troppo grande"); } catch {}
        try { req.destroy(); } catch {}
      }
    });
  }
  if (req.method === "GET" && (url.pathname === "/" || url.pathname === "/index.html")) maybePreloadWhisper();
  if (!isFullMode() && (url.pathname === "/api/quiz" || url.pathname === "/api/flashcards" || url.pathname === "/api/profile" || url.pathname.startsWith("/api/kb") || url.pathname.startsWith("/api/review"))) {
    res.writeHead(403, { "Content-Type": "application/json", "Cache-Control": "no-store" });
    return res.end('{"ok":false,"err":"funzione non disponibile nella modalità essenziale"}');
  }
  if (req.method === "GET" && url.pathname === "/api/models") {
    const list = providerName() === "openrouter" ? MODELS.filter((m) => OR_MODEL_MAP[m]) : MODELS;
    const def = (SETTINGS.model && list.includes(SETTINGS.model)) ? SETTINGS.model : list[0];
    res.writeHead(200, { "Content-Type": "application/json", "Cache-Control": "no-cache" });
    return res.end(JSON.stringify({ models: list, default: def, provider: providerName(), hasKey: keySource() !== "none", vision: MODEL_VISION, visionFallback: VISION_FALLBACK }));
  }
  if (req.method === "GET" && url.pathname === "/api/diagnostics") {
    const d = detectOptional();
    res.writeHead(200, { "Content-Type": "application/json", "Cache-Control": "no-store" });
    return res.end(JSON.stringify({
      ok: true, node: process.version, platform: process.platform, port: PORT,
      python: d.python, sympy: d.sympy, whisper: d.whisper,
      provider: providerName(), model: SETTINGS.model || MODELS[0], hasKey: keySource() !== "none",
      mode: isFullMode() ? "full" : "core",
      level: normalizeLevel(SETTINGS.level) || "auto"
    }));
  }
  if (req.method === "GET" && url.pathname === "/api/settings") {
    const src = keySource();
    res.writeHead(200, { "Content-Type": "application/json", "Cache-Control": "no-store" });
    return res.end(JSON.stringify({
      ok: true, provider: providerName(), model: SETTINGS.model || MODELS[0],
      whisperLanguage: WHISPER_LANG, hasKey: src !== "none", keySource: src,
      keyHint: src === "none" ? "" : (currentKey() || "").slice(-4),
      backup: SETTINGS.backup !== false, backupHours: Number(SETTINGS.backupHours) || 24,
      mode: isFullMode() ? "full" : "core",
      level: normalizeLevel(SETTINGS.level) || "auto"
    }));
  }
  if (req.method === "POST" && url.pathname === "/api/settings") {
    const origin = req.headers.origin;
    if (origin) {
      try { if (new URL(origin).host !== req.headers.host) { res.writeHead(403); return res.end(JSON.stringify({ ok: false, err: "origin non consentita" })); } }
      catch { res.writeHead(403); return res.end(JSON.stringify({ ok: false, err: "origin non valida" })); }
    }
    let b = "";
    req.on("data", (c) => (b += c));
    req.on("end", () => {
      try {
        const j = JSON.parse(b || "{}");
        if (j.mode !== undefined) {
          if (!["core", "full"].includes(j.mode)) throw new Error("modalita' non valida");
          SETTINGS.mode = j.mode;
        }
        if (j.level !== undefined) {
          const lv = normalizeLevel(j.level);
          if (!lv) throw new Error("livello non valido");
          SETTINGS.level = lv;
        }
        if (j.provider !== undefined) {
          if (!["openrouter", "opencode"].includes(j.provider)) throw new Error("provider non valido");
          SETTINGS.provider = j.provider;
        }
        if (j.clearKey === true) delete SETTINGS.apiKey;
        if (typeof j.apiKey === "string") {
          const k = j.apiKey.trim();
          if (k.length > 500) throw new Error("chiave troppo lunga");
          if (k) SETTINGS.apiKey = k;
        }
        if (typeof j.model === "string") {
          if (!MODELS.includes(j.model)) throw new Error("modello non valido");
          SETTINGS.model = j.model;
        }
        if (typeof j.whisperLanguage === "string") {
          if (!/^[a-z]{2}$/.test(j.whisperLanguage)) throw new Error("lingua non valida");
          SETTINGS.whisperLanguage = j.whisperLanguage;
          WHISPER_LANG = j.whisperLanguage;
          if (whisperWorker && whisperWorker.proc) { try { whisperWorker.proc.kill(); } catch {} whisperWorker = null; }
        }
        saveSettingsFile();
        const src = keySource();
        res.writeHead(200, { "Content-Type": "application/json", "Cache-Control": "no-store" });
        res.end(JSON.stringify({ ok: true, provider: providerName(), model: SETTINGS.model || MODELS[0], whisperLanguage: WHISPER_LANG, hasKey: src !== "none", keySource: src, keyHint: src === "none" ? "" : (currentKey() || "").slice(-4), mode: isFullMode() ? "full" : "core", level: normalizeLevel(SETTINGS.level) || "auto" }));
      } catch (e) {
        res.writeHead(400, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ ok: false, err: String(e.message || e) }));
      }
    });
    return;
  }
  if (req.method === "POST" && url.pathname === "/api/geogebra-result") {
    let b = "";
    req.on("data", (c) => (b += c));
    req.on("end", () => {
      try { const { callId, results } = JSON.parse(b); const r = ggbPending.get(callId); if (r) r(results); } catch {}
      res.writeHead(200, { "Content-Type": "application/json" }); res.end('{"ok":true}');
    });
    return;
  }
  if (req.method === "POST" && url.pathname === "/api/conversation/state") {
    let b = "";
    req.on("data", (c) => (b += c));
    req.on("end", () => {
      try {
        const state = JSON.parse(b);
        const { id, ggb, cells, mode, figures } = state;
        if (!id) { res.writeHead(400); return res.end('{"error":"id mancante"}'); }
        const p = convFile(id);
        let old = null;
        try { old = JSON.parse(fs.readFileSync(p, "utf8")); } catch {}
        const now = Date.now();
        const conv = Object.assign({ id, title: "Nuova chat", createdAt: now, updatedAt: now, model: MODELS[0], messages: [] }, old || {});
        const previousRevision = Number.isSafeInteger(conv.stateRevision) ? conv.stateRevision : 0;
        let revision;
        if (state.revision === undefined) {
          // Compatibilità una tantum con il formato precedente; dopo il primo
          // salvataggio versionato, una pagina vecchia non può sovrascriverlo.
          if (previousRevision) {
            res.writeHead(200, { "Content-Type": "application/json" });
            return res.end('{"ok":true,"stale":true}');
          }
          revision = now;
        } else {
          if (!Number.isSafeInteger(state.revision) || state.revision < 0) {
            res.writeHead(400, { "Content-Type": "application/json" });
            return res.end('{"error":"revisione non valida"}');
          }
          revision = state.revision;
          if (revision <= previousRevision) {
            res.writeHead(200, { "Content-Type": "application/json" });
            return res.end('{"ok":true,"stale":true}');
          }
        }
        conv.id = id;
        conv.updatedAt = now;
        conv.stateRevision = revision;
        if (Object.prototype.hasOwnProperty.call(state, "ggb")) conv.ggb = typeof ggb === "string" && ggb ? ggb : null;
        if (Array.isArray(cells) && (cells.length || !(conv.cells || []).length)) conv.cells = cells.slice(-200);
        if (Array.isArray(figures)) {
          // accetto costruzioni emesse dal server o già persistite: quest'ultimo
          // fallback conserva i file legacy che precedono il campo figsIssued.
          // Non consente di aggiungere al salvataggio un fid nuovo inventato dal browser.
          const emesse = new Set([
            ...(Array.isArray(conv.figsIssued) ? conv.figsIssued : []),
            ...(Array.isArray(conv.figures) ? conv.figures.map((f) => f && f.fid).filter(Boolean) : []),
          ]);
          conv.figures = figures
            .filter((f) => f && f.fid && emesse.has(f.fid))
            .slice(-60)
            .map((f) => ({
              fid: String(f.fid), title: String(f.title || "").slice(0, 80),
              commands: Array.isArray(f.commands) ? f.commands.slice(0, 200) : [],
              msgIdx: Number.isInteger(f.msgIdx) ? f.msgIdx : null,
              view: f.view === "3d" ? "3d" : "2d",
            }));
        }
        if (mode) conv.mode = mode;
        if (typeof state.view3d === "boolean") conv.view3d = state.view3d;
        if (Object.prototype.hasOwnProperty.call(state, "view")) {
          if (state.view === null) conv.view = null;
          else if (state.view && typeof state.view === "object") {
            const num = (v) => (Number.isFinite(Number(v)) ? Math.max(-1e6, Math.min(1e6, Number(v))) : null);
            const xmin = num(state.view.xmin), xmax = num(state.view.xmax);
            const ymin = num(state.view.ymin), ymax = num(state.view.ymax);
            if (xmin !== null && xmax !== null && ymin !== null && ymax !== null && xmin < xmax && ymin < ymax) {
              conv.view = { xmin, xmax, ymin, ymax, axes: state.view.axes !== false, grid: state.view.grid === true };
            }
          }
        }
        if (!conv.title || conv.title === "Nuova chat") {
          const firstUser = (conv.messages || []).find((m) => m.role === "user");
          if (firstUser) conv.title = firstUser.content.replace(/\s+/g, " ").trim().slice(0, 90);
          else if ((conv.cells || []).length) conv.title = "Calcoli: " + String(conv.cells[0].expr || "").slice(0, 60);
        }
        fs.writeFileSync(p, JSON.stringify(conv), "utf8");
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end('{"ok":true}');
      } catch (e) {
        logErr("state: " + e.message);
        res.writeHead(400); res.end('{"error":"richiesta non valida"}');
      }
    });
    return;
  }
  if (url.pathname === "/api/backup") {
    if (req.method === "GET") {
      let items = [];
      try {
        items = fs.readdirSync(BACKUP_DIR).filter((f) => f.endsWith(".zip")).map((f) => {
          const st = fs.statSync(path.join(BACKUP_DIR, f));
          return { file: f, size: st.size, t: st.mtimeMs };
        }).sort((a, b) => b.t - a.t);
      } catch {}
      res.writeHead(200, { "Content-Type": "application/json", "Cache-Control": "no-cache" });
      return res.end(JSON.stringify({ items }));
    }
    if (req.method === "POST") {
      const r = runBackup();
      res.writeHead(r.ok ? 200 : 500, { "Content-Type": "application/json" });
      return res.end(JSON.stringify(r));
    }
  }
  if (req.method === "GET" && url.pathname === "/api/history") {
    const q = (url.searchParams.get("q") || "").trim();
    let items = listConvs();
    if (!q) {
      res.writeHead(200, { "Content-Type": "application/json", "Cache-Control": "no-cache" });
      return res.end(JSON.stringify({ items }));
    }
    // "#tag": filtro solo per etichetta
    if (q.startsWith("#")) {
      const tag = q.slice(1).toLowerCase().trim();
      items = items.filter((it) => (it.tags || []).some((t) => t.toLowerCase().includes(tag)));
      res.writeHead(200, { "Content-Type": "application/json", "Cache-Control": "no-cache" });
      return res.end(JSON.stringify({ items }));
    }
    // ricerca globale: titolo, etichette, domande, risposte, calcoli
    const ql = q.toLowerCase();
    const found = [];
    for (const it of items) {
      let c = null;
      try { c = JSON.parse(fs.readFileSync(convFile(it.id), "utf8")); } catch { continue; }
      const where = [];
      let snippet = "";
      if (String(c.title || "").toLowerCase().includes(ql)) where.push("titolo");
      if ((it.tags || []).some((t) => t.toLowerCase().includes(ql))) where.push("tag");
      const clip = (txt) => {
        const flat = String(txt).replace(/\s+/g, " ");
        const i = flat.toLowerCase().indexOf(ql);
        if (i < 0) return "";
        const start = Math.max(0, i - 60), end = Math.min(flat.length, i + ql.length + 60);
        return (start > 0 ? "…" : "") + flat.slice(start, end) + (end < flat.length ? "…" : "");
      };
      for (const m of (c.messages || [])) {
        const txt = String(m.content || "");
        if (txt.toLowerCase().includes(ql)) {
          const who = m.role === "user" ? "domanda" : "risposta";
          if (!where.includes(who)) where.push(who);
          if (!snippet) snippet = clip(txt);
        }
      }
      for (const cell of (c.cells || [])) {
        const txt = String(cell.expr || "");
        if (txt.toLowerCase().includes(ql)) {
          if (!where.includes("calcolo")) where.push("calcolo");
          if (!snippet) snippet = clip(txt);
          break;
        }
      }
      if (where.length) found.push(Object.assign({}, it, { match: { where, snippet } }));
    }
    res.writeHead(200, { "Content-Type": "application/json", "Cache-Control": "no-cache" });
    return res.end(JSON.stringify({ items: found }));
  }
  if (req.method === "POST" && url.pathname === "/api/kb/use") {
    let b = "";
    req.on("data", (c) => (b += c));
    req.on("end", () => {
      try {
        const { id, convId } = JSON.parse(b);
        const ok = kbUse(id, String(convId || ""));
        res.writeHead(ok ? 200 : 404, { "Content-Type": "application/json" });
        res.end(ok ? '{"ok":true}' : '{"error":"documento non trovato"}');
      } catch { res.writeHead(400); res.end('{"error":"bad"}'); }
    });
    return;
  }
  if (req.method === "GET" && url.pathname === "/api/kb/file") {
    const id = url.searchParams.get("id") || "";
    const doc = kbLoad().docs.find((d) => d.id === id);
    if (!doc || !doc.file || !fs.existsSync(doc.file.path)) { res.writeHead(404); return res.end("file non trovato"); }
    const inline = /pdf|image\//i.test(doc.file.mime || "") || /\.(pdf|png|jpe?g|gif|webp|svg|txt|md|wav|mp3|m4a|ogg)$/i.test(doc.file.name || "");
    res.writeHead(200, {
      "Content-Type": doc.file.mime || "application/octet-stream",
      "Content-Disposition": (inline ? "inline" : "attachment") + '; filename="' + encodeURIComponent(doc.file.name || "file") + '"',
      "Cache-Control": "no-cache",
    });
    return fs.createReadStream(doc.file.path).pipe(res);
  }
  if (req.method === "POST" && url.pathname === "/api/transcribe") {
    let b = "";
    req.on("data", (c) => (b += c));
    req.on("end", async () => {
      try {
        const { b64 } = JSON.parse(b);
        if (!b64) { res.writeHead(400); return res.end('{"ok":false,"error":"audio mancante"}'); }
        const t = await audioToText(b64);
        res.writeHead(200, { "Content-Type": "application/json", "Cache-Control": "no-cache" });
        res.end(JSON.stringify(t));
      } catch (e) {
        res.writeHead(500, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ ok: false, error: String(e.message || e) }));
      }
    });
    return;
  }
  // carica un appunto DIRETTAMENTE nella sezione Appunti (senza passare dalla chat)
  if (req.method === "POST" && url.pathname === "/api/kb/add") {
    let b = "";
    req.on("data", (c) => (b += c));
    req.on("end", async () => {
      try {
        const { name, mime, b64 } = JSON.parse(b);
        if (!name || !b64) { res.writeHead(400); return res.end('{"ok":false,"error":"file mancante"}'); }
        const mm = String(mime || "");
        let text = "", kind = "testo";
        if (isAudio(name, mm)) { const t = await audioToText(b64); text = (t && t.ok && t.text) || ""; kind = "audio"; }
        else if (mm.includes("pdf")) { const t = await docToText(name, mm, b64); text = (t && t.ok && t.text) || ""; kind = "pdf"; }
        else if (mm.startsWith("image/")) { kind = "immagine"; }
        else { const t = await docToText(name, mm, b64); text = (t && t.ok && t.text) || ""; }
        const doc = kbAdd(name, kind, text, null, b64, mm);
        if (!doc) { res.writeHead(400); return res.end('{"ok":false,"error":"contenuto non leggibile"}'); }
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ ok: true, doc: { id: doc.id, name: doc.name, chunks: doc.chunks, chars: doc.chars } }));
      } catch (e) {
        res.writeHead(500, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ ok: false, error: String(e.message || e) }));
      }
    });
    return;
  }
  if (req.method === "GET" && url.pathname === "/api/kb") {
    res.writeHead(200, { "Content-Type": "application/json", "Cache-Control": "no-cache" });
    return res.end(JSON.stringify({ docs: kbLoad().docs }));
  }
  if (url.pathname === "/api/kb/doc") {
    const id = url.searchParams.get("id") || "";
    if (req.method === "GET") {
      res.writeHead(200, { "Content-Type": "application/json", "Cache-Control": "no-cache" });
      return res.end(JSON.stringify({ id, chunks: kbChunks().filter((c) => c.docId === id) }));
    }
    if (req.method === "DELETE") {
      const idx = kbLoad();
      const doc = idx.docs.find((d) => d.id === id);
      if (doc && doc.file && doc.file.path) {
        // NON cancello il file: lo sposto nel cestino (recuperabile)
        try {
          const cestino = path.join(KB_DIR, "cestino");
          fs.mkdirSync(cestino, { recursive: true });
          fs.renameSync(doc.file.path, path.join(cestino, path.basename(doc.file.path)));
        } catch (e) { logErr("cestino: " + e.message); }
      }
      idx.docs = idx.docs.filter((d) => d.id !== id); kbSave(idx);
      kbChunksSave(kbChunks().filter((c) => c.docId !== id));
      res.writeHead(200, { "Content-Type": "application/json" }); return res.end('{"ok":true}');
    }
  }
  if (url.pathname === "/api/profile") {
    if (req.method === "GET") {
      res.writeHead(200, { "Content-Type": "application/json", "Cache-Control": "no-cache" });
      return res.end(JSON.stringify({ items: profLoad() }));
    }
    if (req.method === "POST") {
      let b = "";
      req.on("data", (c) => (b += c));
      req.on("end", () => {
        try {
          const c = profAdd(JSON.parse(b).testo, "manuale");
          res.writeHead(c ? 200 : 400, { "Content-Type": "application/json" });
          res.end(c ? JSON.stringify({ ok: true, item: c }) : '{"error":"preferenza troppo corta"}');
        } catch { res.writeHead(400); res.end('{"error":"bad"}'); }
      });
      return;
    }
    if (req.method === "DELETE") {
      const id = url.searchParams.get("id") || "";
      profSave(profLoad().filter((c) => c.id !== id));
      res.writeHead(200, { "Content-Type": "application/json" }); return res.end('{"ok":true}');
    }
  }
  // valutazione di un ripasso (SM-2 semplificato): difficile / media / facile
  if (req.method === "POST" && url.pathname === "/api/review/grade") {
    let b = "";
    req.on("data", (c) => (b += c));
    req.on("end", () => {
      try {
        const { id, q } = JSON.parse(b);
        const list = readReview();
        const it = list.find((r) => r.id === id);
        if (!it) { res.writeHead(404, { "Content-Type": "application/json" }); return res.end('{"error":"voce non trovata"}'); }
        revNorm(it);
        const now = Date.now();
        if (q === "difficile") {
          it.lapses++; it.reps = 0; it.interval = 0;
          it.ease = Math.max(1.3, Math.round((it.ease - 0.2) * 100) / 100);
          it.due = now + 10 * 60 * 1000; // torna fra 10 minuti
        } else if (q === "facile") {
          it.reps++;
          it.interval = it.reps <= 1 ? 3 : it.reps === 2 ? 7 : Math.round(it.interval * it.ease * 1.15);
          it.ease = Math.min(3.2, Math.round((it.ease + 0.1) * 100) / 100);
          it.due = now + it.interval * 86400000;
        } else {
          it.reps++;
          it.interval = it.reps <= 1 ? 1 : it.reps === 2 ? 3 : Math.round(it.interval * it.ease);
          it.due = now + it.interval * 86400000;
        }
        it.lastGrade = q === "difficile" || q === "media" || q === "facile" ? q : "media";
        it.lastT = now;
        writeReview(list);
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ ok: true, item: it }));
      } catch { res.writeHead(400); res.end('{"error":"bad"}'); }
    });
    return;
  }
  if (url.pathname === "/api/review") {
    if (req.method === "GET") {
      res.writeHead(200, { "Content-Type": "application/json", "Cache-Control": "no-cache" });
      return res.end(JSON.stringify({ items: readReview().map(revNorm), now: Date.now() }));
    }
    if (req.method === "POST") {
      let b = "";
      req.on("data", (c) => (b += c));
      req.on("end", () => {
        try {
          const { convId, title, text } = JSON.parse(b);
          const list = readReview();
          const cid = String(convId || "");
          const txt = String(text || "").slice(0, 800);
          // stessa risposta della stessa sessione: aggiorna la data, non duplicare
          const same = list.find((r) => r.convId === cid && String(r.text || "") === txt);
          if (same) {
            same.t = Date.now();
            writeReview(list);
            res.writeHead(200, { "Content-Type": "application/json" });
            return res.end('{"ok":true,"existing":true}');
          }
          list.unshift({ id: crypto.randomUUID(), convId: cid, title: String(title || "").slice(0, 120), text: txt, t: Date.now(), due: Date.now(), reps: 0, ease: 2.5, interval: 0, lapses: 0 });
          writeReview(list);
          res.writeHead(200, { "Content-Type": "application/json" }); res.end('{"ok":true}');
        } catch { res.writeHead(400); res.end('{"error":"bad"}'); }
      });
      return;
    }
    if (req.method === "DELETE") {
      const id = url.searchParams.get("id") || "";
      writeReview(readReview().filter((r) => r.id !== id));
      res.writeHead(200, { "Content-Type": "application/json" }); return res.end('{"ok":true}');
    }
  }
  // flashcard generate dagli appunti (finiscono nel Ripasso con scadenza subito)
  if (req.method === "POST" && url.pathname === "/api/flashcards") {
    let b = "";
    req.on("data", (c) => (b += c));
    req.on("end", async () => {
      try {
        const { docId, n, dry } = JSON.parse(b);
        const doc = kbLoad().docs.find((d) => d.id === docId);
        if (!doc) { res.writeHead(404, { "Content-Type": "application/json" }); return res.end('{"ok":false,"error":"documento non trovato"}'); }
        const testo = kbChunks().filter((c) => c.docId === docId).map((c) => String(c.text || "")).join("\n\n").slice(0, 9000).trim();
        if (testo.length < 40) { res.writeHead(400, { "Content-Type": "application/json" }); return res.end('{"ok":false,"error":"il documento non ha testo indicizzato (immagine o scansione)"}'); }
        const quante = Math.max(3, Math.min(20, Number(n) || 12));
        const prompt = "Dagli ESTRATTI qui sotto crea fino a " + quante + " flashcard di matematica in italiano (domanda breve e precisa; risposta completa ma essenziale, con LaTeX dove serve). Rispondi SOLO con un array JSON nel formato [{\"d\":\"domanda\",\"r\":\"risposta\"}] — niente commenti, niente altro testo.\n\nESTRATTI:\n" + testo;
        if (dry) { res.writeHead(200, { "Content-Type": "application/json" }); return res.end(JSON.stringify({ ok: true, dry: true, prompt })); }
        const model = MODELS[0];
        const out = await callModel(model, [
          { role: "system", content: "Sei un assistente che crea flashcard di studio. Rispondi solo con JSON valido." },
          { role: "user", content: prompt },
        ], { maxTokens: 2200 });
        const cards = parseCards(out.text || "");
        if (!cards.length) { res.writeHead(502, { "Content-Type": "application/json" }); return res.end('{"ok":false,"error":"il modello non ha prodotto flashcard leggibili"}'); }
        const list = readReview();
        const now = Date.now();
        let added = 0;
        for (const c of cards) {
          const dup = list.find((r) => String(r.title || "") === c.d && String(r.text || "") === c.r);
          if (dup) { dup.t = now; continue; }
          list.unshift({ id: crypto.randomUUID(), convId: "kb:" + docId, title: c.d, text: c.r, t: now, type: "flashcard", due: now, reps: 0, ease: 2.5, interval: 0, lapses: 0 });
          added++;
        }
        writeReview(list);
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ ok: true, added, parsed: cards.length, model }));
      } catch (e) {
        res.writeHead(500, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ ok: false, error: String(e.message || e) }));
      }
    });
    return;
  }
  // quiz: domande a risposta multipla generate su un argomento
  if (req.method === "POST" && url.pathname === "/api/quiz") {
    let b = "";
    req.on("data", (c) => (b += c));
    req.on("end", async () => {
      try {
        const { topic, n, dry } = JSON.parse(b);
        const arg = String(topic || "").trim().replace(/\s+/g, " ").slice(0, 300);
        if (arg.length < 3) { res.writeHead(400, { "Content-Type": "application/json" }); return res.end('{"ok":false,"error":"scrivi un argomento (almeno 3 lettere)"}'); }
        const quante = Math.max(3, Math.min(10, Number(n) || 5));
        const prompt = "Crea " + quante + " domande a risposta multipla di matematica in italiano sull'argomento: «" + arg + "».\n"
          + "Rispondi SOLO con un array JSON nel formato [{\"d\":\"domanda\",\"opts\":[\"opzione 1\",\"opzione 2\",\"opzione 3\",\"opzione 4\"],\"ok\":0,\"why\":\"spiegazione breve\"}] — niente commenti, niente altro testo.\n"
          + "Regole: esattamente 4 opzioni per domanda, UNA sola corretta, \"ok\" = indice (0-3) della corretta, \"why\" = perche' e' giusta (1-2 frasi). Distrattori plausibili (errori tipici). Difficolta' crescente. Notazione semplice (x^2, frazioni con /), niente LaTeX.";
        if (dry) { res.writeHead(200, { "Content-Type": "application/json" }); return res.end(JSON.stringify({ ok: true, dry: true, prompt })); }
        const model = MODELS[0];
        const out = await callModel(model, [
          { role: "system", content: "Sei un insegnante che prepara verifiche di matematica. Rispondi solo con JSON valido." },
          { role: "user", content: prompt },
        ], { maxTokens: 2600 });
        const questions = parseQuiz(out.text || "");
        if (!questions.length) { res.writeHead(502, { "Content-Type": "application/json" }); return res.end('{"ok":false,"error":"il modello non ha prodotto domande leggibili, riprova"}'); }
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ ok: true, questions: questions.slice(0, quante), model }));
      } catch (e) {
        res.writeHead(500, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ ok: false, error: String(e.message || e) }));
      }
    });
    return;
  }
  if (req.method === "GET" && url.pathname === "/api/conversation") {
    const id = url.searchParams.get("id") || "";
    try {
      const c = JSON.parse(fs.readFileSync(convFile(id), "utf8"));
      res.writeHead(200, { "Content-Type": "application/json", "Cache-Control": "no-cache" });
      return res.end(JSON.stringify(c));
    } catch { res.writeHead(404); return res.end('{"error":"not found"}'); }
  }
  if (req.method === "DELETE" && url.pathname === "/api/conversation") {
    const id = url.searchParams.get("id") || "";
    try { fs.rmSync(convFile(id), { force: true }); } catch {}
    res.writeHead(200, { "Content-Type": "application/json" });
    return res.end('{"ok":true}');
  }
  // Etichette di una conversazione: {id, tag, action: "add"|"remove"}
  if (req.method === "POST" && url.pathname === "/api/conversation/tags") {
    let b = "";
    req.on("data", (c) => (b += c));
    req.on("end", () => {
      try {
        const { id, tag, action } = JSON.parse(b);
        const clean = String(tag || "").trim().replace(/\s+/g, " ").replace(/^#+/, "").slice(0, 24);
        if (!id || !clean) { res.writeHead(400, { "Content-Type": "application/json" }); return res.end('{"error":"id o etichetta mancanti"}'); }
        const p = convFile(id);
        if (!fs.existsSync(p)) { res.writeHead(404, { "Content-Type": "application/json" }); return res.end('{"error":"conversazione non trovata"}'); }
        const conv = JSON.parse(fs.readFileSync(p, "utf8"));
        let tags = Array.isArray(conv.tags) ? conv.tags.filter((t) => typeof t === "string" && t.trim()) : [];
        const low = clean.toLowerCase();
        if (action === "remove") {
          tags = tags.filter((t) => t.toLowerCase() !== low);
        } else if (!tags.some((t) => t.toLowerCase() === low)) {
          if (tags.length >= 8) { res.writeHead(200, { "Content-Type": "application/json" }); return res.end(JSON.stringify({ ok: false, error: "massimo 8 etichette per argomento", tags })); }
          tags.push(clean);
        }
        conv.tags = tags; // niente bump di updatedAt: l'etichetta non è attività di studio
        fs.writeFileSync(p, JSON.stringify(conv), "utf8");
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ ok: true, tags }));
      } catch (e) {
        res.writeHead(400, { "Content-Type": "application/json" });
        res.end('{"error":"richiesta non valida"}');
      }
    });
    return;
  }
  if (req.method === "POST" && url.pathname === "/api/compute") {
    let b = "";
    req.on("data", (c) => (b += c));
    req.on("end", async () => {
      let args = {};
      try { args = JSON.parse(b); } catch {}
      const out = await runSympy(args);
      res.writeHead(200, { "Content-Type": "application/json", "Cache-Control": "no-cache" });
      res.end(JSON.stringify(out));
    });
    return;
  }
  // Spiegazione di un singolo calcolo del quaderno, in streaming.
  // style "mixed" = parole + formule, "steps" = solo catena algebrica.
  if (req.method === "POST" && url.pathname === "/api/explain") {
    const abortController = new AbortController();
    let clientGone = false;
    const markClientGone = () => {
      if (res.writableEnded) return;
      clientGone = true;
      if (!abortController.signal.aborted) abortController.abort();
    };
    res.on("close", markClientGone);
    req.on("aborted", markClientGone);
    let b = "";
    req.on("data", (c) => (b += c));
    req.on("end", async () => {
      if (abortController.signal.aborted) return;
      let body;
      try { body = JSON.parse(b); } catch { res.writeHead(400); return res.end("bad json"); }
      const op = String(body.op || "").slice(0, 40);
      const expr = String(body.expr || "").slice(0, 600);
      const result = String(body.result || "").slice(0, 3000);
      const latex = String(body.latex || "").slice(0, 1500);
      if (!expr) { res.writeHead(400); return res.end('{"error":"espressione mancante"}'); }
      const model = MODELS.includes(body.model) ? body.model : MODELS[0];
      // L'istruzione critica va anche ACCANTO alla richiesta: cosi' il modello la segue davvero.
      const guardia = "[ISTRUZIONE — scrivi solo la spiegazione finale in italiano, senza raccontare cosa stai per fare e senza inglese.]\n\n";
      const userMsg = `${guardia}Operazione: ${op || "calcolo"}\nEspressione: ${expr}\nRisultato esatto: ${result || "(vedi LaTeX)"}${latex ? "\nLaTeX del risultato: " + latex : ""}\n\nSpiega i passaggi.`;
      res.writeHead(200, { "Content-Type": "text/event-stream; charset=utf-8", "Cache-Control": "no-cache", Connection: "keep-alive", "X-Accel-Buffering": "no" });
      const send = (event, data) => {
        if (!abortController.signal.aborted && !clientGone && !res.writableEnded && !res.destroyed) {
          try { res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`); } catch {}
        }
      };
      try {
        // Budget ampio: il modello "pensa" prima di rispondere e col budget piccolo
        // il ragionamento poteva consumare tutti i token lasciando la risposta vuota.
        await streamWithEscalation("spiega-" + Date.now(), { model, messages: [{ role: "system", content: EXPLAIN_PROMPT }, { role: "user", content: userMsg }], stream: true, max_tokens: 3500 }, send, model, abortController.signal);
        send("done", {});
      } catch (e) {
        if (!abortController.signal.aborted && !clientGone && !res.destroyed) {
          logErr("explain ERR: " + e.message);
          send("error", { message: String(e.message || e) });
        }
      }
      if (!res.writableEnded && !res.destroyed) res.end();
    });
    return;
  }
  if (req.method === "POST" && url.pathname === "/api/chat") {
    const abortController = new AbortController();
    let clientGone = false;
    const markClientGone = () => {
      if (res.writableEnded) return;
      clientGone = true;
      if (!abortController.signal.aborted) abortController.abort();
    };
    // `IncomingMessage.close` si verifica anche quando il corpo POST è stato
    // ricevuto regolarmente; la chiusura dello stream di risposta è il segnale
    // affidabile che il browser ha annullato la chat.
    res.on("close", markClientGone);
    req.on("aborted", markClientGone);
    let b = "";
    req.on("data", (c) => (b += c));
    req.on("end", async () => {
      if (abortController.signal.aborted) return;
      let body;
      try { body = JSON.parse(b); } catch { res.writeHead(400); return res.end("bad json"); }
      const sessionId = body.sessionId || crypto.randomUUID();
      const mode = body.mode === "algebra" ? "algebra" : "figure";
      const convId = body.conversationId || null;
      const model = MODELS.includes(body.model) ? body.model : MODELS[0];
      const rawMsgs = body.messages || [];
      const hasImages = rawMsgs.some((m) => Array.isArray(m.attachments) && m.attachments.some((a) => String(a.mime || "").startsWith("image/")));
      let usedModel = model, notice = null, msgsForBuild = rawMsgs;
      if (hasImages && MODEL_VISION[model] === false) {
        const imgs = [];
        for (const m of rawMsgs) for (const a of (m.attachments || [])) if (String(a.mime || "").startsWith("image/")) imgs.push(a);
        try {
          const txt = await transcribeImages(imgs, sessionId, abortController.signal);
          msgsForBuild = rawMsgs.map((m) => {
            const mine = Array.isArray(m.attachments) ? m.attachments : [];
            const hasImg = m.role === "user" && mine.some((a) => String(a.mime || "").startsWith("image/"));
            return {
              role: m.role,
              content: hasImg ? `${m.content}\n\n[Trascrizione dell'immagine]\n${txt}` : m.content,
              attachments: mine.filter((a) => !String(a.mime || "").startsWith("image/")),
            };
          });
          notice = `Immagini trascritte con «${VISION_FALLBACK}» (strumento visione) per il modello «${model}», che non le vede direttamente.`;
        } catch (e) {
          if (abortController.signal.aborted) return;
          logErr("vision tool: " + e.message);
          usedModel = VISION_FALLBACK;
          notice = `Trascrizione non riuscita (${e.message}): uso «${VISION_FALLBACK}» per questo turno.`;
        }
      }
      const built = await buildUpstream(msgsForBuild);
      if (abortController.signal.aborted || clientGone) return;
      const upstream = built.msgs;
      upstream.__model = usedModel;
      upstream.__conv = convId;
      upstream.__tutor = ["socratic", "step"].includes(body.tutorMode) ? body.tutorMode : null;
      upstream.__dark = !!body.dark;
      upstream.__profile = profForPrompt();

      // Le modalità didattiche vanno ricordate ACCANTO alla domanda: nel solo prompt di sistema
      // il modello le ignora a volte.
      if (upstream.__tutor) {
        const note = upstream.__tutor === "socratic"
          ? "[ISTRUZIONE PRIORITARIA — modalita' ESERCITAMI: NON risolvere e NON mostrare lo svolgimento. Rispondi con UNA sola domanda di guida, breve (max 3 righe), e fermati li'.]\n\n"
          : "[ISTRUZIONE — modalita' PASSO-PASSO: struttura la risposta in passi numerati, ciascuno con titolo nel formato '### Passo N — <cosa fai>'.]\n\n";
        for (let i = upstream.length - 1; i >= 0; i--) {
          if (upstream[i].role !== "user") continue;
          const c = upstream[i].content;
          upstream[i].content = Array.isArray(c)
            ? [{ type: "text", text: note + ((c[0] && c[0].text) || "") }, ...c.slice(1)]
            : note + c;
          break;
        }
      }
      res.writeHead(200, { "Content-Type": "text/event-stream; charset=utf-8", "Cache-Control": "no-cache", Connection: "keep-alive", "X-Accel-Buffering": "no" });
      const send = (event, data) => {
        if (!abortController.signal.aborted && !clientGone && !res.writableEnded && !res.destroyed) {
          try { res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`); } catch {}
        }
      };
      if (notice) send("notice", { text: notice });
      for (const n of built.notices) send("notice", { text: n });

      // rete concettuale: salvo il FILE originale e indicizzo il testo
      for (const d of built.collected) {
        const doc = kbAdd(d.name, d.kind, d.text, convId, d.b64, d.mime);
        if (doc) {
          const parti = [];
          if (doc.file) parti.push("file salvato (" + Math.round(doc.file.size / 1024) + " KB)");
          if (doc.chunks) parti.push(doc.chunks + " blocchi indicizzati");
          send("notice", { text: "«" + d.name + "» salvato negli Appunti: " + parti.join(", ") + "." });
        }
      }
      const ultimaUser = [...rawMsgs].reverse().find((m) => m.role === "user");
      const domanda = ultimaUser ? String(ultimaUser.content || "") : "";
      const trovati = domanda ? kbSearch(domanda, 4) : [];
      if (trovati.length) {
        upstream.__kb = trovati;
        send("sources", {
          items: trovati.map((c) => ({ id: c.docId, doc: c.docName, page: c.page, text: c.text.slice(0, 900) })),
          terms: [...new Set(tokenize(domanda))].filter((t) => t.length >= 5).slice(0, 12),
        });
      }
      try {
        const finalText = await runAgent(upstream, sessionId, send, mode, () => clientGone, abortController.signal);
        if (abortController.signal.aborted || clientGone || res.destroyed) return;
        const toSave = rawMsgs.map((m) => {
          const o = { role: m.role, content: m.content };
          const names = (m.attachments || []).map((a) => a.name);
          if (names.length) o.files = names;
          return o;
        });
        if (finalText) toSave.push({ role: "assistant", content: finalText });
        saveConv(convId, usedModel, toSave);
        send("conv", { id: convId });
      }
      catch (e) {
        if (abortController.signal.aborted || clientGone || res.destroyed) return;
        const m = String(e.message || e); logErr("chat ERR: " + m); send("error", { message: m });
      }
      if (!res.writableEnded && !res.destroyed) res.end();
    });
    return;
  }
  serveStatic(res, url.pathname);
});

server.on("error", (e) => {
  if (e && e.code === "EADDRINUSE") {
    console.error("MathApp: porta " + PORT + " gia' in uso. Chiudi l'altra istanza o usa MATHAPP_PORT.");
    process.exit(1);
  }
  console.error("MathApp: errore server: " + (e && e.message || e));
});
process.on("uncaughtException", (e) => { try { logErr("uncaught: " + (e && e.stack || e)); } catch {} });
process.on("unhandledRejection", (e) => { try { logErr("unhandledRejection: " + (e && e.stack || e)); } catch {} });server.listen(PORT, "127.0.0.1", () => {
  console.log(`MathApp su http://127.0.0.1:${PORT}`);
  try { getKey(); } catch (e) { console.warn("ATTENZIONE: " + e.message); }
  scheduleBackups();
});

