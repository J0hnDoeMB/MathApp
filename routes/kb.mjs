// Appunti e documenti allegati.
import fs from "node:fs";
import path from "node:path";
import { KB_DIR, kbLoad, kbChunks, kbChunksSave, kbUse, kbAdd } from "../lib/kb.mjs";
import { audioToText, isAudio } from "../lib/audio.mjs";
import { docToText } from "../lib/documents.mjs";
import { logErr } from "../lib/log.mjs";

export const feature = "kb";

// Il MIME del client non e' affidabile: il tipo servito dipende dall'estensione.
const FILE_TYPES = new Map([
  [".pdf", ["application/pdf", true]],
  [".png", ["image/png", true]],
  [".jpg", ["image/jpeg", true]],
  [".jpeg", ["image/jpeg", true]],
  [".gif", ["image/gif", true]],
  [".webp", ["image/webp", true]],
  [".txt", ["text/plain; charset=utf-8", true]],
  [".md", ["text/plain; charset=utf-8", true]],
  [".csv", ["text/plain; charset=utf-8", true]],
  [".mp3", ["audio/mpeg", true]],
  [".wav", ["audio/wav", true]],
  [".m4a", ["audio/mp4", true]],
  [".ogg", ["audio/ogg", true]],
  [".svg", ["image/svg+xml", false]],
]);

function servedFile(doc) {
  const ext = path.extname(String(doc.file.name || doc.file.path || "")).toLowerCase();
  const [type, inline] = FILE_TYPES.get(ext) || ["application/octet-stream", false];
  return { type, inline };
}

export function handle(req, res, url) {
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
    if (!doc || !doc.file || !doc.file.path) { res.writeHead(404); return res.end("file non trovato"); }
    const fp = path.resolve(doc.file.path);
    const kbRoot = path.resolve(KB_DIR) + path.sep;
    if (!fp.startsWith(kbRoot) || !fs.existsSync(fp)) { res.writeHead(404); return res.end("file non trovato"); }
    const { type, inline } = servedFile(doc);
    res.writeHead(200, {
      "Content-Type": type,
      "Content-Disposition": (inline ? "inline" : "attachment") + '; filename="' + encodeURIComponent(doc.file.name || "file") + '"',
      "X-Content-Type-Options": "nosniff",
      "Cache-Control": "no-cache",
    });
    const stream = fs.createReadStream(fp);
    stream.on("error", () => { try { res.destroy(); } catch {} });
    return stream.pipe(res);
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
          fs.mkdirSync(cestino, { recursive: true, mode: 0o700 });
          try { fs.chmodSync(cestino, 0o700); } catch {}
          fs.renameSync(doc.file.path, path.join(cestino, path.basename(doc.file.path)));
        } catch (e) { logErr("cestino: " + e.message); }
      }
      idx.docs = idx.docs.filter((d) => d.id !== id); kbSave(idx);
      kbChunksSave(kbChunks().filter((c) => c.docId !== id));
      res.writeHead(200, { "Content-Type": "application/json" }); return res.end('{"ok":true}');
    }
  }
  
  return false;
}
