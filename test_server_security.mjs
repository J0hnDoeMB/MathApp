// Security/robustness smoke test for the local MathApp server.
// Starts the real server on a free port with a throwaway settings/auth file.
import { spawn } from "node:child_process";
import http from "node:http";
import net from "node:net";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import assert from "node:assert/strict";

const root = path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1"));
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "mathapp-sec-"));
const settingsFile = path.join(tmp, "settings.json");
const authFile = path.join(tmp, "noauth.json");
const dataDir = path.join(tmp, "data");
const backupDir = path.join(tmp, "backups");

function freePort() {
  return new Promise((resolve, reject) => {
    const s = net.createServer();
    s.listen(0, "127.0.0.1", () => { const p = s.address().port; s.close(() => resolve(p)); });
    s.on("error", reject);
  });
}
function request(port, method, pathname, { origin, headers, body } = {}) {
  return new Promise((resolve, reject) => {
    const h = { ...(headers || {}) };
    if (origin) h.Origin = origin;
    const req = http.request({ host: "127.0.0.1", port, method, path: pathname, headers: h }, (res) => {
      let b = "";
      res.on("data", (c) => (b += c));
      res.on("end", () => resolve({ status: res.statusCode, body: b, headers: res.headers }));
    });
    req.on("error", reject);
    if (body !== undefined) req.write(body);
    req.end();
  });
}
async function waitReady(port) {
  for (let i = 0; i < 50; i++) {
    try { const r = await request(port, "GET", "/api/settings"); if (r.status === 200) return; } catch {}
    await new Promise((r) => setTimeout(r, 200));
  }
  throw new Error("server non pronto");
}

const port = await freePort();
const child = spawn(process.execPath, ["server.mjs"], {
  cwd: root,
  env: { ...process.env, MATHAPP_PORT: String(port), MATHAPP_SETTINGS_FILE: settingsFile, MATHAPP_AUTH_FILE: authFile, MATHAPP_DATA_DIR: dataDir, MATHAPP_BACKUP_DIR: backupDir, MATHAPP_NO_WHISPER: "1" },
  stdio: ["ignore", "pipe", "pipe"],
  windowsHide: true,
});
let log = "";
child.stdout.on("data", (c) => (log += c));
child.stderr.on("data", (c) => (log += c));
const checks = [];
function chk(name, cond, extra = "") { checks.push({ name, ok: !!cond, extra }); if (!cond) console.error("FAIL " + name + (extra ? " | " + extra : "")); }

try {
  await waitReady(port);
  const base = `http://127.0.0.1:${port}`;

  const home = await request(port, "GET", "/");
  chk("GET / -> 200 con UI", home.status === 200 && /Impostazioni/.test(home.body));

  const s0 = await request(port, "GET", "/api/settings");
  const j0 = JSON.parse(s0.body);
  chk("GET /api/settings -> provider openrouter senza chiave", j0.ok === true && j0.provider === "openrouter" && j0.hasKey === false);
  chk("X-Request-Id presente", /^req_/.test(String(s0.headers["x-request-id"] || "")));
  chk("default mode -> core", j0.mode === "core");
  chk("default level -> auto", j0.level === "auto");
  const kbCore = await request(port, "GET", "/api/kb");
  chk("core: /api/kb -> 403", kbCore.status === 403);
  chk("core: /api/profile -> 403", (await request(port, "GET", "/api/profile")).status === 403);
  chk("core: /api/review -> 403", (await request(port, "GET", "/api/review")).status === 403);
  chk("core: /api/quiz -> 403", (await request(port, "POST", "/api/quiz")).status === 403);
  chk("core: /api/flashcards -> 403", (await request(port, "POST", "/api/flashcards")).status === 403);

  const diag = await request(port, "GET", "/api/diagnostics");
  const dj = JSON.parse(diag.body);
  chk("GET /api/diagnostics -> 200", diag.status === 200 && dj.ok === true && typeof dj.node === "string" && typeof dj.python !== "undefined");
  chk("diagnostics: storage/port", dj.dataDirOk === true && dj.backupDirOk === true && typeof dj.port === "number");
  chk("diagnostics: capabilities", dj.capabilities && dj.capabilities.chat.available === true && typeof dj.coreOk === "boolean" && dj.adaptersOk === true);
  const health = await request(port, "GET", "/api/health");
  chk("GET /api/health -> 200", health.status === 200 && JSON.parse(health.body).dataDirOk === true);
  const traces = await request(port, "GET", "/api/traces?limit=5");
  chk("GET /api/traces -> 200", traces.status === 200 && Array.isArray(JSON.parse(traces.body).items));

  const evil = await request(port, "POST", "/api/settings", { origin: "https://evil.example", headers: { "Content-Type": "application/json" }, body: "{}" });
  chk("POST cross-origin -> 403", evil.status === 403);

  const evilChat = await request(port, "POST", "/api/chat", { origin: "https://evil.example", headers: { "Content-Type": "application/json" }, body: "{}" });
  chk("POST /api/chat cross-origin -> 403", evilChat.status === 403);

  const save = await request(port, "POST", "/api/settings", {
    origin: base,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ provider: "openrouter", apiKey: "sk-or-v1-security-test-9999", model: "deepseek-v4-flash", whisperLanguage: "en", mode: "full", level: "approfondito" }),
  });
  const j1 = JSON.parse(save.body);
  chk("POST settings same-origin -> 200", save.status === 200 && j1.ok === true && j1.hasKey === true && j1.keyHint === "9999");
  chk("mode salvata -> full", j1.mode === "full");
  chk("level salvato -> approfondito", j1.level === "approfondito");
  const legacy = await request(port, "POST", "/api/settings", { origin: base, headers: { "Content-Type": "application/json" }, body: JSON.stringify({ level: "superiore" }) });
  chk("legacy level -> dettagliato", legacy.status === 200 && JSON.parse(legacy.body).level === "dettagliato");
  const kbFull = await request(port, "GET", "/api/kb");
  chk("full: /api/kb -> 200", kbFull.status === 200);
  const backup = await request(port, "GET", "/api/backup");
  chk("GET /api/backup -> 200", backup.status === 200 && Array.isArray(JSON.parse(backup.body).items));
  const kbText = Buffer.from("La derivata di x^2 e' 2x. Questa nota serve al test delle route degli appunti.").toString("base64");
  const kbAdd = await request(port, "POST", "/api/kb/add", { origin: base, headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name: "smoke.txt", mime: "text/plain", b64: kbText }) });
  const kbDoc = JSON.parse(kbAdd.body);
  chk("POST /api/kb/add -> 200", kbAdd.status === 200 && kbDoc.ok === true && kbDoc.doc && kbDoc.doc.id);
  const prof = await request(port, "POST", "/api/profile", { origin: base, headers: { "Content-Type": "application/json" }, body: JSON.stringify({ testo: "Preferisco passaggi brevi con un esempio concreto" }) });
  chk("POST /api/profile -> 200", prof.status === 200 && JSON.parse(prof.body).ok === true);
  const review = await request(port, "POST", "/api/review", { origin: base, headers: { "Content-Type": "application/json" }, body: JSON.stringify({ convId: "smoke", title: "Derivata", text: "La derivata di x^2 e' 2x" }) });
  chk("POST /api/review -> 200", review.status === 200 && JSON.parse(review.body).ok === true);
  const revList = JSON.parse((await request(port, "GET", "/api/review")).body).items;
  const revItem = revList.find((r) => r.text === "La derivata di x^2 e' 2x");
  const grade = await request(port, "POST", "/api/review/grade", { origin: base, headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id: revItem && revItem.id, q: "facile" }) });
  const graded = JSON.parse(grade.body).item || {};
  chk("POST /api/review/grade -> SM-2", grade.status === 200 && graded.interval === 3 && graded.lastGrade === "facile");
  const quizDry = await request(port, "POST", "/api/quiz", { origin: base, headers: { "Content-Type": "application/json" }, body: JSON.stringify({ dry: true, topic: "derivate", n: 3 }) });
  chk("POST /api/quiz dry -> 200", quizDry.status === 200 && JSON.parse(quizDry.body).dry === true);
  if (dj.sympy) {
    const calc = await request(port, "POST", "/api/compute", { origin: base, headers: { "Content-Type": "application/json" }, body: JSON.stringify({ operation: "diff", expr: "x^2" }) });
    const calcJson = JSON.parse(calc.body);
    chk("POST /api/compute -> SymPy esatto", calc.status === 200 && calcJson.ok === true && String(calcJson.result || "").includes("2"));
  } else {
    chk("POST /api/compute -> skip (SymPy non installato)", true);
  }
  chk("risposta senza chiave completa", !save.body.includes("security-test-9999"));
  chk("settings.json scritto in modo atomico", fs.existsSync(settingsFile) && JSON.parse(fs.readFileSync(settingsFile, "utf8")).apiKey === "sk-or-v1-security-test-9999");

  const clear = await request(port, "POST", "/api/settings", { origin: base, headers: { "Content-Type": "application/json" }, body: JSON.stringify({ clearKey: true }) });
  chk("clearKey -> 200 senza chiave", clear.status === 200 && JSON.parse(clear.body).hasKey === false);

  const stateId = "state-test";
  const stateBody = {
    id: stateId, revision: 1, ggb: "<ggb/>",
    cells: [{ expr: "x^2", op: "diff", result: "2*x" }],
    figures: [], mode: "figure", view3d: false,
    view: { xmin: -5, xmax: 5, ymin: -5, ymax: 5, axes: true, grid: true },
  };
  const stateSave = await request(port, "POST", "/api/conversation/state", { origin: base, headers: { "Content-Type": "application/json" }, body: JSON.stringify(stateBody) });
  chk("conversation/state -> 200", stateSave.status === 200 && JSON.parse(stateSave.body).ok === true);
  const stateGet = await request(port, "GET", `/api/conversation?id=${encodeURIComponent(stateId)}`);
  const saved = JSON.parse(stateGet.body);
  chk("session persistence: ggb/cells/view/schema", stateGet.status === 200 && saved.ggb === "<ggb/>" && saved.cells.length === 1 && saved.view && saved.view.xmin === -5 && saved.stateRevision === 1 && saved.schemaVersion === 1);
  const stale = await request(port, "POST", "/api/conversation/state", { origin: base, headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ...stateBody, ggb: "<stale/>" }) });
  const staleJson = JSON.parse(stale.body);
  const afterStale = JSON.parse((await request(port, "GET", `/api/conversation?id=${encodeURIComponent(stateId)}`)).body);
  chk("state revision: stale non sovrascrive", stale.status === 200 && staleJson.stale === true && afterStale.ggb === "<ggb/>");
  const badRevision = await request(port, "POST", "/api/conversation/state", { origin: base, headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ...stateBody, revision: -1 }) });
  chk("state: revisione negativa -> 400", badRevision.status === 400);
  const noId = await request(port, "POST", "/api/conversation/state", { origin: base, headers: { "Content-Type": "application/json" }, body: JSON.stringify({ revision: 1 }) });
  chk("state: id mancante -> 400", noId.status === 400);
  const history = await request(port, "GET", "/api/history");
  const histJson = JSON.parse(history.body);
  chk("history includes persisted session", history.status === 200 && histJson.items.some((it) => it.id === stateId && it.cells === 1));

  const trav1 = await request(port, "GET", "/../server.mjs");
  const trav2 = await request(port, "GET", "/..%2Fserver.mjs");
  chk("path traversal non serve server.mjs", trav1.status !== 200 && trav2.status !== 200 && !trav1.body.includes("MathApp server") && !trav2.body.includes("MathApp server"));

  // Body cap: Content-Length oltre il limite -> 413 senza leggere il corpo.
  const big = await request(port, "POST", "/api/chat", { headers: { "Content-Type": "application/json", "Content-Length": String(65 * 1024 * 1024) } });
  chk("body > 64MB -> 413", big.status === 413);
} finally {
  child.kill();
  await new Promise((r) => setTimeout(r, 500));
  try { fs.rmSync(tmp, { recursive: true, force: true }); } catch {}
}

const failed = checks.filter((c) => !c.ok);
for (const c of checks) console.log((c.ok ? "OK   " : "FAIL ") + c.name + (c.ok || !c.extra ? "" : " | " + c.extra));
console.log("----");
console.log(`OK=${checks.length - failed.length} FAIL=${failed.length}`);
if (failed.length) { console.error(log.slice(-1200)); process.exit(1); }
