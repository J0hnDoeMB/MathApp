// Persistenza JSON: scrittura atomica e quarantena dei file corrotti.
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { logErr } from "./log.mjs";

export function readJson(file, fallback = null, { quarantine = true } = {}) {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch (e) {
    if (e && e.code === "ENOENT") return fallback;
    logErr("json read " + file + ": " + e.message);
    if (quarantine) {
      try { fs.renameSync(file, file + ".corrupt-" + Date.now()); } catch {}
    }
    return fallback;
  }
}

export function writeJsonAtomic(file, value, { pretty = false } = {}) {
  const tmp = file + ".tmp." + process.pid + "." + crypto.randomBytes(4).toString("hex");
  try {
    fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
    fs.writeFileSync(tmp, pretty ? JSON.stringify(value, null, 2) : JSON.stringify(value), { encoding: "utf8", mode: 0o600 });
    fs.renameSync(tmp, file);
    try { fs.chmodSync(file, 0o600); } catch {}
    return { ok: true };
  } catch (e) {
    try { fs.rmSync(tmp, { force: true }); } catch {}
    logErr("json write " + file + ": " + e.message);
    return { ok: false, error: String(e.message || e) };
  }
}
