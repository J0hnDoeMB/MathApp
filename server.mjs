// MathApp server — chat AI (OpenCode Go) + tool SymPy + GeoGebra in streaming.
// Node built-in only. Avvio: node server.mjs
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import crypto from "node:crypto";
import { parseCards } from "./lib/flashparse.mjs";
import { parseQuiz } from "./lib/quizparse.mjs";
import { settings as SETTINGS, SETTINGS_FILE, MAX_BODY, providerName, keySource, currentKey, getKey, saveSettingsFile, detectOptional } from "./lib/config.mjs";
import { MODELS, MODEL_VISION, VISION_FALLBACK, OR_MODEL_MAP } from "./lib/models.mjs";
import { logErr } from "./lib/log.mjs";
import { BACKUP_DIR, convFile, saveConv, listConvs, readReview, writeReview, revNorm, runBackup, scheduleBackups } from "./lib/storage.mjs";
import { profLoad, profSave, profAdd, profForPrompt } from "./lib/profile.mjs";
import { runSympy } from "./lib/sympy.mjs";
import { runGGB, runGGBEdit, resolveGGB } from "./lib/geogebra.mjs";
import { buildUpstream, docToText } from "./lib/documents.mjs";
import { audioToText, isAudio, maybePreloadWhisper, setWhisperLanguage } from "./lib/audio.mjs";
import { EXPLAIN_PROMPT } from "./lib/prompts.mjs";
import { runAgent, streamWithEscalation } from "./lib/agent.mjs";
import { normalizeLevel } from "./lib/levels.mjs";
import { KB_DIR, kbLoad, kbSave, kbChunks, kbChunksSave, kbUse, kbAdd, kbSearch, tokenize } from "./lib/kb.mjs";
import { transcribeImages } from "./lib/llm.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.MATHAPP_PORT) || 8790;
const isFullMode = () => SETTINGS.mode === "full";
const PUBLIC = path.join(__dirname, "public");

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
// L'IA riceve sempre tutti gli strumenti e la regola "due letture" (algebrica + geometrica),
// in qualunque modalita' della UI.
// Istruzioni extra per le modalità didattiche
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
      whisperLanguage: (SETTINGS.whisperLanguage || "it"), hasKey: src !== "none", keySource: src,
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
          setWhisperLanguage(j.whisperLanguage);
        }
        saveSettingsFile();
        const src = keySource();
        res.writeHead(200, { "Content-Type": "application/json", "Cache-Control": "no-store" });
        res.end(JSON.stringify({ ok: true, provider: providerName(), model: SETTINGS.model || MODELS[0], whisperLanguage: (SETTINGS.whisperLanguage || "it"), hasKey: src !== "none", keySource: src, keyHint: src === "none" ? "" : (currentKey() || "").slice(-4), mode: isFullMode() ? "full" : "core", level: normalizeLevel(SETTINGS.level) || "auto" }));
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
      try { const { callId, results } = JSON.parse(b); resolveGGB(callId, results); } catch {}
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
      upstream.__profile = profForPrompt(isFullMode());

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
        const finalText = await runAgent(upstream, sessionId, send, () => clientGone, abortController.signal);
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

