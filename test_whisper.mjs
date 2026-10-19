// Test di regressione del trascrittore Whisper:
// 1) protocollo worker (modello caricato una volta, più richieste);
// 2) endpoint /api/transcribe con worker riutilizzato (nessun nuovo processo per richiesta).
import assert from "node:assert/strict";
import { spawn, execFileSync } from "node:child_process";
import fs from "node:fs";
import { fileURLToPath } from "node:url";

const B = "http://127.0.0.1:8790";
const PY = "python";
const CLI = fileURLToPath(new URL("./transcribe.py", import.meta.url));
const audioPath = process.env.MATHAPP_TEST_AUDIO;
if (!audioPath || !fs.existsSync(audioPath)) {
  console.log("SKIP: imposta MATHAPP_TEST_AUDIO con un file audio di prova.");
  process.exit(0);
}
const audio = fs.readFileSync(audioPath).toString("base64");

function countWorkers() {
  const script = "(Get-CimInstance Win32_Process | Where-Object { $_.Name -like 'python*' -and $_.CommandLine -like '*transcribe.py --worker*' } | Measure-Object).Count";
  return Number(execFileSync("powershell.exe", ["-NoProfile", "-Command", script], { encoding: "utf8" }).trim());
}

// ---------- 1) protocollo worker diretto ----------
const worker = spawn(PY, [CLI, "--worker", "small", "it"], { windowsHide: true });
let buf = "", workerExited = false, workerStderr = "";
const replies = [];
worker.stdout.on("data", (d) => {
  buf += d.toString("utf8");
  let i;
  while ((i = buf.indexOf("\n")) >= 0) {
    const line = buf.slice(0, i).trim();
    buf = buf.slice(i + 1);
    if (!line) continue;
    try { replies.push(JSON.parse(line)); } catch {}
  }
});
worker.stderr.on("data", (d) => { workerStderr += d.toString("utf8").slice(-400); });
worker.stdin.on("error", () => {}); // se il worker muore non deve far crashare il test
worker.on("error", () => {});
worker.once("exit", () => { workerExited = true; });
await new Promise((resolve) => worker.once("spawn", resolve));
try { worker.stdin.write(JSON.stringify({ id: 1, b64: audio }) + "\n"); } catch {}
try { worker.stdin.write(JSON.stringify({ id: 2, b64: audio }) + "\n"); } catch {}

const deadline = Date.now() + 300000;
while (replies.filter((m) => m.id).length < 2 && !workerExited && Date.now() < deadline) {
  await new Promise((r) => setTimeout(r, 120));
}
if (workerExited && replies.filter((m) => m.id).length < 2) {
  assert.fail("il worker non gestisce il protocollo (uscito in anticipo): " + workerStderr.slice(0, 300));
}
worker.stdin.write(JSON.stringify({ cmd: "exit" }) + "\n");
worker.kill();
await Promise.race([new Promise((resolve) => worker.once("exit", resolve)), new Promise((r) => setTimeout(r, 5000))]);

const r1 = replies.find((m) => m.id === 1);
const r2 = replies.find((m) => m.id === 2);
assert.ok(r1 && r1.ok, "prima risposta del worker: " + JSON.stringify(r1 || replies).slice(0, 300));
assert.ok(r2 && r2.ok, "seconda risposta del worker: " + JSON.stringify(r2 || replies).slice(0, 300));
assert.equal(r2.text, r1.text, "due trascrizioni dello stesso audio devono coincidere");
assert.equal(r1.language, "it", "la lingua deve essere quella richiesta");
assert.match(r1.text, /derivata/i, "il testo deve contenere il contenuto reale");
assert.equal(r1.model, "small");

// ---------- 2) endpoint server con worker riutilizzato ----------
const before = countWorkers();
const t1 = Date.now();
const j1 = await fetch(B + "/api/transcribe", {
  method: "POST", headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ b64: audio }),
}).then((r) => r.json());
const d1 = (Date.now() - t1) / 1000;
const t2 = Date.now();
const j2 = await fetch(B + "/api/transcribe", {
  method: "POST", headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ b64: audio }),
}).then((r) => r.json());
const d2 = (Date.now() - t2) / 1000;
assert.ok(j1.ok && j2.ok, "endpoint /api/transcribe: " + JSON.stringify(j1).slice(0, 300));
assert.equal(j2.text, j1.text);
assert.match(j1.text, /derivata/i);

const after = countWorkers();
assert.ok(after >= 1, "il server deve mantenere un worker Whisper attivo");
assert.ok(after === before || after === before + 1, `il numero di worker non deve crescere a ogni richiesta (prima ${before}, dopo ${after})`);

console.log("PASS: worker Whisper persistente e riutilizzato", {
  protocollo: "ok",
  modelloServer: j1.model,
  primaRichiesta: d1.toFixed(1) + "s",
  secondaRichiesta: d2.toFixed(1) + "s",
  workerPrima: before,
  workerDopo: after,
});
