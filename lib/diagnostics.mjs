// Diagnostica unica per API e launcher: dipendenze, provider, storage, porta.
import { settings as SETTINGS, providerName, keySource, detectOptional } from "./config.mjs";
import { DATA_DIR, BACKUP_DIR } from "./storage.mjs";
import { normalizeLevel } from "./levels.mjs";
import { dirWritable } from "./fs-check.mjs";
import { capabilityReport } from "./capabilities.mjs";

export function diagnostics(port) {
  const opt = detectOptional();
  const data = dirWritable(DATA_DIR);
  const backup = dirWritable(BACKUP_DIR);
  const hasKey = keySource() !== "none";
  const caps = capabilityReport();
  return {
    ok: data.ok && backup.ok,
    node: process.version,
    platform: process.platform,
    port: Number(port) || 8790,
    python: opt.python,
    sympy: opt.sympy,
    pypdf: opt.pypdf,
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
    capabilities: caps.capabilities,
    coreOk: caps.ok,
  };
}
