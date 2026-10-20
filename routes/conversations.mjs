// Route di sessione, cronologia e stato GeoGebra.
import fs from "node:fs";
import { MODELS } from "../lib/models.mjs";
import { convFile, listConvs } from "../lib/storage.mjs";
import { logErr } from "../lib/log.mjs";

export function handle(req, res, url) {
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
    return true;
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
    return true;
  }
  
  return false;
}
