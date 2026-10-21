// Rete concettuale: documenti allegati, blocchi indicizzati e ricerca BM25-lite.
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { DATA_DIR } from "./storage.mjs";
import { logErr } from "./log.mjs";
import { readJson, writeJsonAtomic } from "./json-store.mjs";
import { normalizeDocument, normalizeChunk } from "./schema.mjs";

export const KB_DIR = path.join(DATA_DIR, "kb");
const KB_INDEX = path.join(KB_DIR, "index.json");
const KB_CHUNKS = path.join(KB_DIR, "chunks.json");
const STOP = new Set(["della", "delle", "dello", "degli", "questo", "questa", "questi", "queste", "sono", "essere", "avere", "come", "anche", "perche", "quando", "dove", "quale", "quali", "tutto", "tutti", "molto", "poco", "the", "and", "for", "with", "that", "this", "from", "una", "uno", "gli", "dei", "che", "non", "per", "con", "tra", "fra", "sul", "sui", "nel", "nei", "alla", "allo", "agli", "essere", "fare", "piu", "meno", "solo", "ogni", "sua", "suo", "suoi", "sue",
  "quanto", "quanti", "quante", "cosa", "chi", "cita", "citami", "dimmi", "spiega", "spiegami", "elenca", "calcola", "risolvi", "trova", "mostra", "fammi", "vorrei", "puoi", "sapresti", "riguarda", "parla", "dice", "contiene", "miei", "mio", "mia", "appunti", "appunto", "libro", "libri", "pdf", "file", "documento", "allegato", "allegati", "breve", "righe", "riga", "punto", "punti", "sopra", "sotto", "quindi", "allora", "dopo", "prima"]);

export function kbLoad() {
  const idx = readJson(KB_INDEX, { docs: [] });
  idx.docs = Array.isArray(idx.docs) ? idx.docs.map(normalizeDocument).filter(Boolean) : [];
  return idx;
}

export function kbSave(idx) {
  try {
    idx.docs = idx.docs.map(normalizeDocument).filter(Boolean);
    writeJsonAtomic(KB_INDEX, idx);
  } catch (e) { logErr("kbSave: " + e.message); }
}

export function kbChunks() {
  const list = readJson(KB_CHUNKS, []);
  return Array.isArray(list) ? list.map(normalizeChunk).filter(Boolean) : [];
}

export function kbChunksSave(list) {
  try {
    writeJsonAtomic(KB_CHUNKS, list.map(normalizeChunk).filter(Boolean).slice(-5000));
  } catch (e) { logErr("kbChunksSave: " + e.message); }
}

// normalizzazione leggera dell'italiano: "limite"/"limiti" -> "limit"
export function stem(w) {
  let x = String(w);
  if (x.length <= 4) return x;
  x = x.replace(/(zione|zioni|mente|ita|ivi|iva|ive|ivo|ali|ale|osi|oso|osa|ose|ici|ica|ico|iche|logie|logia)$/, "");
  x = x.replace(/[aeio]$/, "");
  return x.length >= 3 ? x : w;
}

export function tokenize(s) {
  return String(s || "").toLowerCase().replace(/[^\p{L}\p{N}\s]/gu, " ").split(/\s+/)
    .filter((w) => w.length > 3 && !STOP.has(w))
    .map(stem);
}

export function chunkText(text) {
  const out = [];
  const raw = String(text || "");
  const parts = raw.split(/---\s*pagina\s*(\d+)\s*---/i);
  const segs = [];
  if (parts.length > 1) {
    for (let i = 1; i < parts.length; i += 2) segs.push({ page: parseInt(parts[i], 10), text: parts[i + 1] || "" });
  } else segs.push({ page: null, text: raw });
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

// collega un documento alla conversazione corrente (puo' essere in uso in piu' chat)
export function kbUse(id, convId) {
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

export function kbInConv(doc, convId) {
  if (!convId) return false;
  if (doc.convId === convId) return true;
  return Array.isArray(doc.convIds) && doc.convIds.includes(convId);
}

// salva un allegato: FILE originale + testo indicizzato
export function kbAdd(name, kind, text, convId, b64, mime) {
  const body = String(text || "").trim();
  const id = crypto.createHash("sha1").update(body || String(name) + Date.now()).digest("hex").slice(0, 12);
  const idx = kbLoad();
  const esistente = idx.docs.find((d) => d.id === id);
  if (esistente) { kbUse(id, convId); return kbLoad().docs.find((d) => d.id === id); }

  let file = null;
  try {
    const ext = (String(name).match(/\.[a-z0-9]+$/i) || [""])[0].toLowerCase();
    const dir = path.join(KB_DIR, "files");
    fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
    try { fs.chmodSync(dir, 0o700); } catch {}
    const fp = path.join(dir, id + ext);
    const buf = Buffer.from(String(b64 || ""), "base64");
    if (buf.length) {
      fs.writeFileSync(fp, buf, { mode: 0o600 });
      try { fs.chmodSync(fp, 0o600); } catch {}
      file = { path: fp, name, ext, size: buf.length, mime: mime || "application/octet-stream" };
    }
  } catch (e) { logErr("kbAdd file: " + e.message); }

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

// ricerca "BM25-lite": cerca in tutta la rete, rinforza il documento nominato,
// richiede un punteggio minimo per evitare citazioni a caso.
export function kbSearch(query, k = 4) {
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
