// Ripristina un backup di data/ creato da MathApp.
//
// Uso: node scripts/restore-backup.mjs [backup.zip]
// Senza argomento usa lo zip piu' recente in backups/.
// Il server deve essere fermo: lo script rifiuta di lavorare se il lock
// dell'istanza appartiene a un processo ancora vivo.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const dataDir = process.env.MATHAPP_DATA_DIR ? path.resolve(process.env.MATHAPP_DATA_DIR) : path.join(root, "data");
const backupDir = process.env.MATHAPP_BACKUP_DIR ? path.resolve(process.env.MATHAPP_BACKUP_DIR) : path.join(root, "backups");

function fail(message) {
  console.error("ERRORE: " + message);
  process.exit(1);
}

function pickBackup(arg) {
  if (arg) return path.resolve(arg);
  let files = [];
  try {
    files = fs.readdirSync(backupDir).filter((f) => f.endsWith(".zip")).sort();
  } catch {
    fail("cartella backup non trovata: " + backupDir);
  }
  if (!files.length) fail("nessun backup in " + backupDir);
  return path.join(backupDir, files[files.length - 1]);
}

function alive(pid) {
  if (!Number.isSafeInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function checkStopped() {
  const lock = path.join(dataDir, ".mathapp-instance.lock");
  if (!fs.existsSync(lock)) return;
  let info = null;
  try {
    info = JSON.parse(fs.readFileSync(lock, "utf8"));
  } catch {
    fail("lock dell'istanza illeggibile; ferma MathApp e rimuovi " + lock);
  }
  if (info && alive(Number(info.pid))) {
    fail("MathApp sembra in esecuzione (pid " + info.pid + "); fermalo prima del ripristino");
  }
}

function zipEntries(zip) {
  const r = spawnSync("tar", ["-tf", zip], { encoding: "utf8", windowsHide: true });
  if (r.error || r.status !== 0) fail("impossibile leggere lo zip (serve tar): " + (r.stderr || r.error));
  return String(r.stdout || "").split(/\r?\n/).filter(Boolean);
}

function safeRelative(name, top) {
  const normalized = name.replace(/\\/g, "/");
  if (/^\/|^[A-Za-z]:/.test(normalized)) fail("voce assoluta nello zip: " + name);
  if (normalized.split("/").some((part) => part === "..")) fail("voce fuori dalla cartella nello zip: " + name);
  const clean = normalized.replace(/^\.\//, "");
  if (clean === top) return "";
  if (!clean.startsWith(top + "/")) fail("voce inattesa nello zip: " + name);
  return clean.slice(top.length + 1);
}

function validateTree(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.isSymbolicLink()) fail("collegamento simbolico non ammesso nel backup: " + entry.name);
    if (entry.isDirectory()) validateTree(path.join(dir, entry.name));
    else if (!entry.isFile()) fail("voce non regolare nel backup: " + entry.name);
  }
}

const zip = pickBackup(process.argv[2]);
if (!fs.existsSync(zip)) fail("backup non trovato: " + zip);
checkStopped();

const top = path.basename(dataDir);
const entries = zipEntries(zip);
for (const name of entries) safeRelative(name, top);

const staging = fs.mkdtempSync(path.join(os.tmpdir(), "mathapp-restore-"));
try {
  const r = spawnSync("tar", ["-xf", zip, "-C", staging], { encoding: "utf8", windowsHide: true });
  if (r.error || r.status !== 0) fail("estrazione fallita: " + (r.stderr || r.error));
  const source = path.join(staging, top);
  if (!fs.existsSync(source) || !fs.statSync(source).isDirectory()) fail("lo zip non contiene " + top + "/");
  validateTree(source);

  const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, "-");
  const safety = dataDir + ".pre-restore-" + stamp;
  if (fs.existsSync(dataDir)) fs.renameSync(dataDir, safety);
  try {
    fs.cpSync(source, dataDir, {
      recursive: true,
      filter: (src) => path.basename(src) !== ".mathapp-instance.lock",
    });
    try { fs.chmodSync(dataDir, 0o700); } catch {}
  } catch (e) {
    try { fs.rmSync(dataDir, { recursive: true, force: true }); } catch {}
    if (fs.existsSync(safety)) fs.renameSync(safety, dataDir);
    fail("copia fallita, dati precedenti ripristinati: " + e.message);
  }
  console.log("Ripristinato: " + zip);
  console.log("Dati: " + dataDir);
  console.log("Copia di sicurezza dei dati precedenti: " + safety);
  console.log("Riavvia MathApp.");
} finally {
  try { fs.rmSync(staging, { recursive: true, force: true }); } catch {}
}
