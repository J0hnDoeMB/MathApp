// Studio: flashcard e quiz.
import crypto from "node:crypto";
import { MODELS } from "../lib/models.mjs";
import { kbLoad, kbChunks } from "../lib/kb.mjs";
import { readReview, writeReview } from "../lib/storage.mjs";
import { flashcardPrompt, quizPrompt, generateFlashcards, generateQuiz } from "../lib/study.mjs";

export const feature = "study";

export function handle(req, res, url) {
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
        const prompt = flashcardPrompt(testo, n);
        if (dry) { res.writeHead(200, { "Content-Type": "application/json" }); return res.end(JSON.stringify({ ok: true, dry: true, prompt })); }
        const model = MODELS[0];
        const { cards } = await generateFlashcards({ text: testo, n, model });
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
        const prompt = quizPrompt(arg, n);
        if (dry) { res.writeHead(200, { "Content-Type": "application/json" }); return res.end(JSON.stringify({ ok: true, dry: true, prompt })); }
        const model = MODELS[0];
        const { questions } = await generateQuiz({ topic: arg, n, model });
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

  return false;
}
