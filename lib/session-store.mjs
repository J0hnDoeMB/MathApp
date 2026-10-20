// Repository delle sessioni: unico punto che legge/scrive conversation JSON.
import fs from "node:fs";
import path from "node:path";
import { CONVDIR, convFile } from "./storage.mjs";
import { MODELS } from "./models.mjs";
import { logErr } from "./log.mjs";
import { SCHEMA_VERSION, MAX_FIGURES, MAX_TAGS, migrateSession, validateState, cleanTag } from "./schema.mjs";

export function readSession(id) {
  if (!id) return null;
  try { return migrateSession(JSON.parse(fs.readFileSync(convFile(id), "utf8"))); }
  catch { return null; }
}

export function writeSession(session, touch = true) {
  try {
    session.schemaVersion = SCHEMA_VERSION;
    if (touch) session.updatedAt = Date.now();
    fs.writeFileSync(convFile(session.id), JSON.stringify(session), "utf8");
    return true;
  } catch (e) {
    logErr("writeSession: " + e.message);
    return false;
  }
}

export function listSessions() {
  const out = [];
  for (const f of fs.readdirSync(CONVDIR)) {
    if (!f.endsWith(".json")) continue;
    try {
      const c = migrateSession(JSON.parse(fs.readFileSync(path.join(CONVDIR, f), "utf8")));
      const nMsg = c.messages.length, nCells = c.cells.length, nFigs = c.figures.length;
      if (!nMsg && !nCells && !nFigs) continue;
      out.push({
        id: c.id, title: c.title, updatedAt: c.updatedAt, count: nMsg, cells: nCells, figures: nFigs,
        hasGgb: !!c.ggb, mode: c.mode || null, tags: c.tags,
      });
    } catch {}
  }
  return out.sort((a, b) => b.updatedAt - a.updatedAt);
}

export function saveConv(id, model, msgs) {
  if (!id) return;
  const old = readSession(id);
  const firstUser = msgs.find((m) => m.role === "user");
  const title = (old && old.title) || (firstUser ? firstUser.content.replace(/\s+/g, " ").trim().slice(0, 90) : "Nuova chat");
  const conv = {
    ...(old || {}),
    id, title, createdAt: (old && old.createdAt) || Date.now(), updatedAt: Date.now(), model, messages: msgs,
    ggb: (old && old.ggb) || null,
    cells: (old && old.cells) || [],
    figures: (old && old.figures) || [],
    figsIssued: (old && old.figsIssued) || [],
    mode: (old && old.mode) || null,
    schemaVersion: SCHEMA_VERSION,
  };
  writeSession(conv);
}

export function applyState(raw) {
  const parsed = validateState(raw);
  if (!parsed.ok) return { ok: false, status: 400, error: parsed.error };
  const st = parsed.state;
  const old = readSession(st.id);
  const now = Date.now();
  const conv = migrateSession(old || { id: st.id, title: "Nuova chat", createdAt: now, model: MODELS[0], messages: [] });
  const previousRevision = conv.stateRevision || 0;
  let revision;
  if (st.revision === null) {
    if (previousRevision) return { ok: true, stale: true };
    revision = now;
  } else {
    revision = st.revision;
    if (revision <= previousRevision) return { ok: true, stale: true };
  }
  conv.id = st.id;
  conv.updatedAt = now;
  conv.stateRevision = revision;
  if (st.hasGgb) conv.ggb = st.ggb;
  if (st.cells !== undefined && (st.cells.length || !(conv.cells || []).length)) conv.cells = st.cells.slice(-200);
  if (st.figures !== undefined) {
    const emesse = new Set([
      ...(Array.isArray(conv.figsIssued) ? conv.figsIssued : []),
      ...(Array.isArray(conv.figures) ? conv.figures.map((f) => f && f.fid).filter(Boolean) : []),
    ]);
    conv.figures = st.figures
      .filter((f) => f && f.fid && emesse.has(f.fid))
      .slice(-MAX_FIGURES)
      .map((f) => ({
        fid: String(f.fid), title: String(f.title || "").slice(0, 80),
        commands: Array.isArray(f.commands) ? f.commands.slice(0, 200) : [],
        msgIdx: Number.isInteger(f.msgIdx) ? f.msgIdx : null,
        view: f.view === "3d" ? "3d" : "2d",
      }));
  }
  if (st.mode) conv.mode = st.mode;
  if (st.view3d !== undefined) conv.view3d = st.view3d;
  if (st.hasView) conv.view = st.view;
  if (!conv.title || conv.title === "Nuova chat") {
    const firstUser = (conv.messages || []).find((m) => m.role === "user");
    if (firstUser) conv.title = firstUser.content.replace(/\s+/g, " ").trim().slice(0, 90);
    else if ((conv.cells || []).length) conv.title = "Calcoli: " + String(conv.cells[0].expr || "").slice(0, 60);
  }
  if (!writeSession(conv)) return { ok: false, status: 500, error: "salvataggio non riuscito" };
  return { ok: true };
}

export function history(q) {
  const query = String(q || "").trim();
  let items = listSessions();
  if (!query) return items;
  if (query.startsWith("#")) {
    const tag = query.slice(1).toLowerCase().trim();
    return items.filter((it) => it.tags.some((t) => t.toLowerCase().includes(tag)));
  }
  const ql = query.toLowerCase();
  const found = [];
  for (const it of items) {
    const c = readSession(it.id);
    if (!c) continue;
    const where = [];
    let snippet = "";
    if (String(c.title || "").toLowerCase().includes(ql)) where.push("titolo");
    if (it.tags.some((t) => t.toLowerCase().includes(ql))) where.push("tag");
    const clip = (txt) => {
      const flat = String(txt).replace(/\s+/g, " ");
      const i = flat.toLowerCase().indexOf(ql);
      if (i < 0) return "";
      const start = Math.max(0, i - 60), end = Math.min(flat.length, i + ql.length + 60);
      return (start > 0 ? "..." : "") + flat.slice(start, end) + (end < flat.length ? "..." : "");
    };
    for (const m of c.messages) {
      const txt = String(m.content || "");
      if (txt.toLowerCase().includes(ql)) {
        const who = m.role === "user" ? "domanda" : "risposta";
        if (!where.includes(who)) where.push(who);
        if (!snippet) snippet = clip(txt);
      }
    }
    for (const cell of c.cells) {
      const txt = String(cell.expr || "");
      if (txt.toLowerCase().includes(ql)) {
        if (!where.includes("calcolo")) where.push("calcolo");
        if (!snippet) snippet = clip(txt);
        break;
      }
    }
    if (where.length) found.push(Object.assign({}, it, { match: { where, snippet } }));
  }
  return found;
}

export function deleteSession(id) {
  try { fs.rmSync(convFile(id), { force: true }); } catch {}
}

export function updateTags(id, tag, action) {
  const clean = cleanTag(tag);
  if (!id || !clean) return { status: 400, ok: false, error: "id o etichetta mancanti" };
  const conv = readSession(id);
  if (!conv) return { status: 404, ok: false, error: "conversazione non trovata" };
  let tags = conv.tags.filter((t) => typeof t === "string" && t.trim());
  const low = clean.toLowerCase();
  if (action === "remove") tags = tags.filter((t) => t.toLowerCase() !== low);
  else if (!tags.some((t) => t.toLowerCase() === low)) {
    if (tags.length >= MAX_TAGS) return { status: 200, ok: false, error: "massimo 8 etichette per argomento", tags };
    tags.push(clean);
  }
  conv.tags = tags;
  writeSession(conv, false);
  return { status: 200, ok: true, tags };
}
