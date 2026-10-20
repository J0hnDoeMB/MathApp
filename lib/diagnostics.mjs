// Diagnostica unica per API e launcher: dipendenze, provider, storage, porta.
import fs from "node:fs";
import path from "node:path";
import { settings as SETTINGS, providerName, keySource, detectOptional } from "./config.mjs";
import { DATA_DIR, BACKUP_DIR } from "./storage.mjs";
import { normalizeLevel } from "./levels.mjs";

function dirWritable(dir) {
  try {
    fs.mkdirSync(dir, { recursive: true });
    const probe = path.join(dir, ".write-probe-" + process.pid);
    fs.writeFileSync(probe, "ok");
    fs.rmSync(probe, { force: true });
    return { ok: true };
  } catch (e) {
    return { ok: false, error: String(e.message || e) };
  }
}

export function diagnostics(port) {
  const opt = detectOptional();
  const data = dirWritable(DATA_DIR);
  const backup = dirWritable(BACKUP_DIR);
  const hasKey = keySource() !== "none";
  return {
    ok: data.ok && backup.ok,
    node: process.version,
    platform: process.platform,
    port: Number(port) || 8790,
    python: opt.python,
    sympy: opt.sympy,
    whisper: opt.whisper,
    provider: providerName(),
    hasKey,
    keySource: keySource(),
    dataDir: DATA_DIR,
    dataDirOk: data.ok,
    dataError: data.error || null,
    backupDir: BACKUP_DIR,
    backupDirOk: backup.ok,
    backupError: backup.error || null,
    mode: SETTINGS.mode === "full" ? "full" : "core",
    level: normalizeLevel(SETTINGS.level) || "auto",
  };
}
