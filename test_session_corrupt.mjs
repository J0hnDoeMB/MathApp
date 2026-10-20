// Session recovery: un file JSON corrotto viene messo in quarantena e non blocca la lista.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import assert from "node:assert/strict";

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "mathapp-session-"));
process.env.MATHAPP_DATA_DIR = path.join(tmp, "data");
process.env.MATHAPP_BACKUP_DIR = path.join(tmp, "backups");
const store = await import("./lib/session-store.mjs?test=" + Date.now());
const storage = await import("./lib/storage.mjs?test=" + Date.now());

let ok = 0, fail = 0;
function chk(name, cond) { if (cond) { console.log("OK   " + name); ok++; } else { console.error("FAIL " + name); fail++; } }
try {
  store.saveConv("corrupt-test", "test-model", [{ role: "user", content: "ciao" }]);
  chk("session: save/read", store.readSession("corrupt-test")?.messages.length === 1);
  fs.writeFileSync(storage.convFile("corrupt-test"), "{non-json", "utf8");
  chk("session: corrotto -> null", store.readSession("corrupt-test") === null);
  const files = fs.readdirSync(storage.CONVDIR);
  chk("session: quarantena", files.some((f) => f.includes(".corrupt-")) && !files.includes("corrupt-test.json"));
  chk("session: lista ignora corrotto", store.listSessions().every((s) => s.id !== "corrupt-test"));
} finally {
  fs.rmSync(tmp, { recursive: true, force: true });
}
console.log("----");
console.log("OK=" + ok + " FAIL=" + fail);
if (fail) process.exit(1);
