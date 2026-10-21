// Single-instance guard per data directory: prevents two servers from
// writing the same conversations/review files. Stale PID locks are recovered.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { DATA_DIR } from "./storage.mjs";

const LOCK_FILE = path.join(DATA_DIR, ".mathapp-instance.lock");
const HOST = os.hostname();

function readLock() {
  try {
    const raw = fs.readFileSync(LOCK_FILE, "utf8");
    const info = JSON.parse(raw);
    return info && typeof info === "object" ? info : null;
  } catch {
    return null;
  }
}

function isAlive(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (e) {
    return e && e.code === "EPERM";
  }
}

function ownerSummary(info) {
  if (!info) return "unknown";
  const when = info.startedAt ? " since " + info.startedAt : "";
  return "PID " + info.pid + when + (info.port ? " on port " + info.port : "");
}

export function acquireInstanceLock(meta = {}) {
  try {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  } catch (e) {
    return { ok: false, error: "data directory not writable: " + e.message };
  }

  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const fd = fs.openSync(LOCK_FILE, "wx");
      try {
        fs.writeFileSync(fd, JSON.stringify({
          pid: process.pid,
          host: HOST,
          port: Number(meta.port) || null,
          startedAt: new Date().toISOString(),
        }), "utf8");
      } finally {
        fs.closeSync(fd);
      }
      return {
        ok: true,
        file: LOCK_FILE,
        release() {
          try {
            const current = readLock();
            if (!current || current.pid === process.pid) fs.rmSync(LOCK_FILE, { force: true });
          } catch {}
        },
      };
    } catch (e) {
      if (e && e.code !== "EEXIST") return { ok: false, error: "cannot create instance lock: " + e.message };
      const owner = readLock();
      if (owner && (!owner.host || owner.host === HOST) && isAlive(owner.pid)) {
        return { ok: false, code: "ELOCKED", owner, error: "another instance is already using " + DATA_DIR + " (" + ownerSummary(owner) + ")" };
      }
      try { fs.rmSync(LOCK_FILE, { force: true }); } catch {}
    }
  }
  return { ok: false, error: "cannot acquire instance lock in " + DATA_DIR };
}
