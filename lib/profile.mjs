// Memoria di stile dell'utente (feature "Completa").
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { DATA_DIR } from "./storage.mjs";
import { logErr } from "./log.mjs";
import { readJson, writeJsonAtomic } from "./json-store.mjs";
import { normalizeProfileItem } from "./schema.mjs";

const PROFILE_FILE = path.join(DATA_DIR, "profile.json");

export function profLoad() {
  try {
    const j = readJson(PROFILE_FILE, []);
    return Array.isArray(j) ? j.map(normalizeProfileItem).filter(Boolean) : [];
  } catch { return []; }
}

export function profSave(list) {
  try {
    writeJsonAtomic(PROFILE_FILE, list.map(normalizeProfileItem).filter(Boolean).slice(0, 200));
  } catch (e) { logErr("profSave: " + e.message); }
}

export function profAdd(testo, source) {
  const raw = String(testo || "").replace(/\s+/g, " ").trim();
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

export function profForPrompt(fullMode) {
  if (!fullMode) return [];
  const list = profLoad().slice(0, 30);
  for (const c of list) c.hits = (c.hits || 0) + 1;
  profSave(profLoad().map((c) => {
    const f = list.find((x) => x.id === c.id);
    return f ? { ...c, hits: f.hits } : c;
  }));
  return list;
}
