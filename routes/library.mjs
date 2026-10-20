// Route delle funzioni didattiche opzionali: appunti, stile, ripasso, quiz.
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { MODELS } from "../lib/models.mjs";
import { callModel } from "../lib/llm.mjs";
import { parseCards } from "../lib/flashparse.mjs";
import { parseQuiz } from "../lib/quizparse.mjs";
import { runSympy } from "../lib/sympy.mjs";
import { audioToText, isAudio } from "../lib/audio.mjs";
import { docToText } from "../lib/documents.mjs";
import { KB_DIR, kbLoad, kbChunks, kbChunksSave, kbUse, kbAdd, kbSave } from "../lib/kb.mjs";
import { profLoad, profSave, profAdd } from "../lib/profile.mjs";
import { readReview, writeReview, revNorm, runBackup, BACKUP_DIR } from "../lib/storage.mjs";
import { logErr } from "../lib/log.mjs";

export function handle(req, res, url) {
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
    return true;
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
    return true;
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
    return true;
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
    return true;
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
    return true;
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
    return true;
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
    return true;
  }
  
  return false;
}
