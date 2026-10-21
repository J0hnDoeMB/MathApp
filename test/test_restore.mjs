// Restore CLI: archivio valido, dati precedenti conservati, rifiuto senza server.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "mathapp-restore-test-"));
const dataDir = path.join(tmp, "data");
const backupDir = path.join(tmp, "backups");
const script = path.join(root, "scripts", "restore-backup.mjs");
let ok = 0, fail = 0;
function chk(name, cond, detail) {
  if (cond) { console.log("OK   " + name); ok++; }
  else { console.error("FAIL " + name + (detail ? " " + detail : "")); fail++; }
}
function run(args = []) {
  return spawnSync(process.execPath, [script, ...args], {
    cwd: root,
    env: { ...process.env, MATHAPP_DATA_DIR: dataDir, MATHAPP_BACKUP_DIR: backupDir },
    encoding: "utf8",
    windowsHide: true,
  });
}

try {
  fs.mkdirSync(path.join(dataDir, "conversations"), { recursive: true });
  fs.writeFileSync(path.join(dataDir, "conversations", "one.json"), JSON.stringify({ id: "one", title: "Prima" }), "utf8");
  fs.mkdirSync(backupDir, { recursive: true });
  const zip = path.join(backupDir, "mathapp-test.zip");
  const made = spawnSync("tar", ["-a", "-c", "-f", zip, "-C", tmp, "data"], { encoding: "utf8", windowsHide: true });
  chk("archivio di prova creato", made.status === 0 && fs.existsSync(zip), made.stderr || "");

  fs.writeFileSync(path.join(dataDir, "conversations", "one.json"), JSON.stringify({ id: "one", title: "Modificata" }), "utf8");
  fs.writeFileSync(path.join(dataDir, "conversations", "two.json"), JSON.stringify({ id: "two" }), "utf8");
  const restored = run([zip]);
  chk("restore completato", restored.status === 0, restored.stderr || restored.stdout);
  const one = JSON.parse(fs.readFileSync(path.join(dataDir, "conversations", "one.json"), "utf8"));
  chk("contenuto ripristinato", one.title === "Prima", JSON.stringify(one));
  chk("file successivo rimosso", !fs.existsSync(path.join(dataDir, "conversations", "two.json")));

  const safety = fs.readdirSync(tmp).filter((f) => f.startsWith("data.pre-restore-"));
  chk("copia dei dati precedenti conservata", safety.length === 1, JSON.stringify(safety));

  const lockPid = process.pid;
  fs.writeFileSync(path.join(dataDir, ".mathapp-instance.lock"), JSON.stringify({ pid: lockPid }), "utf8");
  const blocked = run([zip]);
  chk("rifiuta con istanza attiva", blocked.status !== 0 && /in esecuzione/i.test(blocked.stderr || ""), blocked.stderr || "");
} finally {
  fs.rmSync(tmp, { recursive: true, force: true });
}

console.log("----");
console.log(`OK=${ok} FAIL=${fail}`);
if (fail) process.exit(1);
