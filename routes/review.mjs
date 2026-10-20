// Ripasso SM-2.
import crypto from "node:crypto";
import { readReview, writeReview, revNorm } from "../lib/storage.mjs";
import { gradeReview } from "../lib/review.mjs";

export function handle(req, res, url) {
if (req.method === "POST" && url.pathname === "/api/review/grade") {
    let b = "";
    req.on("data", (c) => (b += c));
    req.on("end", () => {
      try {
        const { id, q } = JSON.parse(b);
        const list = readReview();
        const it = list.find((r) => r.id === id);
        if (!it) { res.writeHead(404, { "Content-Type": "application/json" }); return res.end('{"error":"voce non trovata"}'); }
        gradeReview(it, q);
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
  
  return false;
}
