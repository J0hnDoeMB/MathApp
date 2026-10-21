// Cronologia: cache delle intestazioni, paginazione e ricerca; scheduler backup.
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "mathapp-history-"));
process.env.MATHAPP_DATA_DIR = path.join(tmp, "data");
process.env.MATHAPP_BACKUP_DIR = path.join(tmp, "backups");
process.env.MATHAPP_SETTINGS_FILE = path.join(tmp, "settings.json");
const store = await import("../lib/session-store.mjs?test=" + Date.now());
const storage = await import("../lib/storage.mjs?test=" + Date.now());
const cfg = await import("../lib/config.mjs");

let ok = 0, fail = 0;
function chk(name, cond) { if (cond) { console.log("OK   " + name); ok++; } else { console.error("FAIL " + name); fail++; } }
try {
  const base = Date.now() - 100000;
  for (let i = 0; i < 5; i++) {
    store.saveConv("s" + i, "test-model", [{ role: "user", content: "alpha " + i }]);
    const s = store.readSession("s" + i);
    s.updatedAt = base + i * 1000;
    s.title = "Titolo " + i;
    store.writeSession(s, false);
  }
  const all = store.listSessions();
  chk("history: lista completa", all.length === 5);
  chk("history: ordine aggiornati", all[0].id === "s4");

  const s2 = store.readSession("s2");
  s2.title = "Titolo modificato";
  store.writeSession(s2, false);
  chk("history: cache invalidata dalla scrittura", store.listSessions().find((s) => s.id === "s2")?.title === "Titolo modificato");

  const file = storage.convFile("s3");
  const external = JSON.parse(fs.readFileSync(file, "utf8"));
  external.title = "Titolo esterno";
  fs.writeFileSync(file, JSON.stringify(external), "utf8");
  fs.utimesSync(file, new Date(), new Date(Date.now() + 2000));
  chk("history: cache invalidata da mtime", store.listSessions().find((s) => s.id === "s3")?.title === "Titolo esterno");

  const first = store.history("", { limit: 2, offset: 0 });
  chk("history: prima pagina", first.items.length === 2 && first.total === 5 && first.hasMore === true);
  const tail = store.history("", { limit: 2, offset: 4 });
  chk("history: ultima pagina", tail.items.length === 1 && tail.hasMore === false);

  const found = store.history("alpha 1", { limit: 1, offset: 0 });
  chk("history: ricerca nel contenuto", found.total === 1 && found.items[0].id === "s1");

  store.updateTags("s0", "esame", "add");
  const tagged = store.history("#esame", { limit: 50, offset: 0 });
  chk("history: ricerca per tag", tagged.total === 1 && tagged.items[0].id === "s0");

  store.deleteSession("s0");
  chk("history: delete invalida la cache", store.listSessions().length === 4 && store.history("", {}).total === 4);

  cfg.setSettings({ backup: true, backupHours: 12 });
  const sched = storage.backupSchedule();
  chk("backup: scheduler legge le impostazioni correnti", sched.enabled === true && sched.hours === 12);
  cfg.setSettings({ backup: false, backupHours: 6 });
  const off = storage.backupSchedule();
  chk("backup: scheduler rispetta la disattivazione", off.enabled === false && off.hours === 6);
} finally {
  fs.rmSync(tmp, { recursive: true, force: true });
}
console.log("----");
console.log("OK=" + ok + " FAIL=" + fail);
if (fail) process.exit(1);
