// Observability: trace JSONL con request/operation id, senza dati di contenuto.
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { ROOT } from "./config.mjs";

const DIR = process.env.MATHAPP_TRACE_DIR ? path.resolve(process.env.MATHAPP_TRACE_DIR) : path.join(ROOT, "logs");
const FILE = path.join(DIR, "trace.jsonl");
const MAX_BYTES = 2 * 1024 * 1024;

function append(entry) {
  try {
    fs.mkdirSync(DIR, { recursive: true, mode: 0o700 });
    try { fs.chmodSync(DIR, 0o700); } catch {}
    try {
      if (fs.statSync(FILE).size > MAX_BYTES) {
        const old = FILE + ".1";
        try { fs.rmSync(old, { force: true }); } catch {}
        fs.renameSync(FILE, old);
      }
    } catch {}
    fs.appendFileSync(FILE, JSON.stringify(entry) + "\n", { encoding: "utf8", mode: 0o600 });
    try { fs.chmodSync(FILE, 0o600); } catch {}
  } catch {}
}

export function newId(prefix = "id") {
  return String(prefix) + "_" + crypto.randomUUID();
}

export function trace(event, data = {}) {
  append({ ts: new Date().toISOString(), event, ...data });
}

export function startOperation(name, meta = {}) {
  const id = newId("op");
  const started = process.hrtime.bigint();
  let ended = false;
  trace("op.start", { id, name, ...meta });
  return {
    id,
    end(extra = {}) {
      if (ended) return;
      ended = true;
      const ms = Number(process.hrtime.bigint() - started) / 1e6;
      trace("op.end", { id, name, ms: Math.round(ms * 10) / 10, ...meta, ...extra });
    },
  };
}

export function recent(limit = 100) {
  try {
    const lines = fs.readFileSync(FILE, "utf8").trim().split("\n").filter(Boolean).slice(-Math.max(1, Math.min(1000, Number(limit) || 100)));
    return lines.map((line) => { try { return JSON.parse(line); } catch { return null; } }).filter(Boolean);
  } catch { return []; }
}
