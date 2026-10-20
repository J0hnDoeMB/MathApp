// Observability: trace JSONL, operation id e durata, senza rete.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import assert from "node:assert/strict";

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "mathapp-trace-"));
process.env.MATHAPP_TRACE_DIR = tmp;
const obs = await import("./lib/observability.mjs?test=" + Date.now());

let ok = 0, fail = 0;
function chk(name, cond) { if (cond) { console.log("OK   " + name); ok++; } else { console.error("FAIL " + name); fail++; } }

try {
  obs.trace("test.event", { a: 1 });
  const op = obs.startOperation("test.op", { requestId: "req-x" });
  op.end({ ok: true });
  const items = obs.recent(20);
  chk("trace: evento scritto", items.some((e) => e.event === "test.event" && e.a === 1));
  chk("trace: start/end con id", items.some((e) => e.event === "op.start" && e.id === op.id) && items.some((e) => e.event === "op.end" && e.id === op.id));
  const end = items.find((e) => e.event === "op.end" && e.id === op.id);
  chk("trace: durata numerica", end && typeof end.ms === "number" && end.ms >= 0 && typeof obs.newId("x") === "string");
} finally {
  fs.rmSync(tmp, { recursive: true, force: true });
}
console.log("----");
console.log("OK=" + ok + " FAIL=" + fail);
if (fail) process.exit(1);
