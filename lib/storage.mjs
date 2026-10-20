// Storage locale: conversazioni, ripasso e backup di data/.
// Nessuna dipendenza dal server HTTP: solo filesystem e config.
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { settings as SETTINGS } from "./config.mjs";
import { logErr } from "./log.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
export const DATA_DIR = path.join(ROOT, "data");
export const CONVDIR = path.join(DATA_DIR, "conversations");
export const REVIEW_FILE = path.join(DATA_DIR, "review.json");
export const BACKUP_DIR = path.join(ROOT, "backups");

try { fs.mkdirSync(CONVDIR, { recursive: true }); } catch {}

export function convFile(id) {
  return path.join(CONVDIR, String(id).replace(/[^a-zA-Z0-9_-]/g, "") + ".json");
}

export function saveConv(id, model, msgs) {
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

export function listConvs() {
  const out = [];
  for (const f of fs.readdirSync(CONVDIR)) {
    if (!f.endsWith(".json")) continue;
    try {
      const c = JSON.parse(fs.readFileSync(path.join(CONVDIR, f), "utf8"));
      const nMsg = (c.messages || []).length, nCells = (c.cells || []).length, nFigs = (c.figures || []).length;
      if (!nMsg && !nCells && !nFigs) continue;
      out.push({
        id: c.id, title: c.title, updatedAt: c.updatedAt, count: nMsg, cells: nCells, figures: nFigs,
        hasGgb: !!c.ggb, mode: c.mode || null,
        tags: Array.isArray(c.tags) ? c.tags.filter((t) => typeof t === "string") : [],
      });
    } catch {}
  }
  return out.sort((a, b) => b.updatedAt - a.updatedAt);
}

export function readReview() {
  try { return JSON.parse(fs.readFileSync(REVIEW_FILE, "utf8")); } catch { return []; }
}

export function writeReview(list) {
  try {
    fs.mkdirSync(path.dirname(REVIEW_FILE), { recursive: true });
    fs.writeFileSync(REVIEW_FILE, JSON.stringify(list.slice(0, 500)), "utf8");
  } catch {}
}

// riporta una voce vecchia (senza campi di ripetizione) allo schema SM-2
export function revNorm(r) {
  if (typeof r.due !== "number") r.due = Number(r.t) || Date.now();
  if (typeof r.reps !== "number") r.reps = 0;
  if (typeof r.ease !== "number") r.ease = 2.5;
  if (typeof r.interval !== "number") r.interval = 0;
  if (typeof r.lapses !== "number") r.lapses = 0;
  return r;
}

// ---------- copie di sicurezza di data/ (chat, appunti, ripasso) ----------
export function runBackup() {
  try {
    fs.mkdirSync(BACKUP_DIR, { recursive: true });
    const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, "-");
    const name = "mathapp-" + stamp + ".zip";
    const dest = path.join(BACKUP_DIR, name);
    let r = spawnSync("tar", ["-a", "-c", "-f", dest, "-C", ROOT, "data"], { windowsHide: true });
    if (r.error || r.status !== 0 || !fs.existsSync(dest)) {
      spawnSync("powershell", ["-NoProfile", "-Command",
        "Compress-Archive -Path '" + DATA_DIR + "' -DestinationPath '" + dest + "' -Force"], { windowsHide: true });
    }
    if (!fs.existsSync(dest)) return { ok: false, error: "archivio non creato" };
    const files = fs.readdirSync(BACKUP_DIR).filter((f) => f.endsWith(".zip")).sort();
    while (files.length > 7) { try { fs.rmSync(path.join(BACKUP_DIR, files.shift()), { force: true }); } catch {} }
    return { ok: true, file: name, size: fs.statSync(dest).size };
  } catch (e) {
    logErr("backup: " + e.message);
    return { ok: false, error: String(e.message || e) };
  }
}

export function scheduleBackups() {
  if (SETTINGS.backup === false) return;
  const every = Number(SETTINGS.backupHours) > 0 ? Number(SETTINGS.backupHours) : 24;
  const timer = setInterval(runBackup, every * 3600 * 1000);
  if (timer.unref) timer.unref();
  const first = setTimeout(() => { runBackup(); }, 90 * 1000);
  if (first.unref) first.unref();
}
