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
  env: { ...process.env, MATHAPP_PORT: String(port), MATHAPP_SETTINGS_FILE: settingsFile, MATHAPP_AUTH_FILE: authFile, MATHAPP_NO_WHISPER: "1" },
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
  chk("default mode -> core", j0.mode === "core");
  chk("default level -> auto", j0.level === "auto");
  const kbCore = await request(port, "GET", "/api/kb");
  chk("core: /api/kb -> 403", kbCore.status === 403);

  const diag = await request(port, "GET", "/api/diagnostics");
  const dj = JSON.parse(diag.body);
  chk("GET /api/diagnostics -> 200", diag.status === 200 && dj.ok === true && typeof dj.node === "string" && typeof dj.python !== "undefined");

  const evil = await request(port, "POST", "/api/settings", { origin: "https://evil.example", headers: { "Content-Type": "application/json" }, body: "{}" });
  chk("POST cross-origin -> 403", evil.status === 403);

  const evilChat = await request(port, "POST", "/api/chat", { origin: "https://evil.example", headers: { "Content-Type": "application/json" }, body: "{}" });
  chk("POST /api/chat cross-origin -> 403", evilChat.status === 403);

  const save = await request(port, "POST", "/api/settings", {
    origin: base,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ provider: "openrouter", apiKey: "sk-or-v1-security-test-9999", model: "deepseek-v4-flash", whisperLanguage: "en", mode: "full", level: "universita" }),
  });
  const j1 = JSON.parse(save.body);
  chk("POST settings same-origin -> 200", save.status === 200 && j1.ok === true && j1.hasKey === true && j1.keyHint === "9999");
  chk("mode salvata -> full", j1.mode === "full");
  chk("level salvato -> universita", j1.level === "universita");
  const kbFull = await request(port, "GET", "/api/kb");
  chk("full: /api/kb -> 200", kbFull.status === 200);
  chk("risposta senza chiave completa", !save.body.includes("security-test-9999"));
  chk("settings.json scritto in modo atomico", fs.existsSync(settingsFile) && JSON.parse(fs.readFileSync(settingsFile, "utf8")).apiKey === "sk-or-v1-security-test-9999");

  const clear = await request(port, "POST", "/api/settings", { origin: base, headers: { "Content-Type": "application/json" }, body: JSON.stringify({ clearKey: true }) });
  chk("clearKey -> 200 senza chiave", clear.status === 200 && JSON.parse(clear.body).hasKey === false);

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
