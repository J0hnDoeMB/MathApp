// Smoke GeoGebra: costruzione -> base64 -> stato server -> reload -> rebuild.
// Richiede rete per il CDN GeoGebra e un browser locale/CI.
import { spawn } from "node:child_process";
import http from "node:http";
import net from "node:net";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
let puppeteer;
try {
  puppeteer = require("puppeteer-core");
} catch {
  const mod = process.env.MATHAPP_PUPPETEER;
  if (!mod) {
    console.log("SKIP: puppeteer-core non installato.");
    process.exit(0);
  }
  const pkg = fs.existsSync(path.join(mod, "package.json"))
    ? path.join(mod, "lib", "puppeteer", "puppeteer-core.js")
    : mod;
  puppeteer = await import(pathToFileURL(pkg).href);
}

const root = path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1"));
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "mathapp-ggb-"));
const settingsFile = path.join(tmp, "settings.json");
const authFile = path.join(tmp, "noauth.json");
const dataDir = path.join(tmp, "data");
const backupDir = path.join(tmp, "backups");
fs.writeFileSync(settingsFile, JSON.stringify({ provider: "openrouter", mode: "core" }), "utf8");

function freePort() {
  return new Promise((resolve, reject) => {
    const s = net.createServer();
    s.listen(0, "127.0.0.1", () => { const p = s.address().port; s.close(() => resolve(p)); });
    s.on("error", reject);
  });
}
function request(port, method, pathname, body) {
  return new Promise((resolve, reject) => {
    const req = http.request({ host: "127.0.0.1", port, method, path: pathname, headers: body ? { "Content-Type": "application/json" } : {} }, (res) => {
      let b = "";
      res.on("data", (c) => (b += c));
      res.on("end", () => resolve({ status: res.statusCode, body: b }));
    });
    req.on("error", reject);
    if (body) req.write(JSON.stringify(body));
    req.end();
  });
}
async function waitReady(port) {
  for (let i = 0; i < 60; i++) {
    try { const r = await request(port, "GET", "/api/settings"); if (r.status === 200) return; } catch {}
    await new Promise((r) => setTimeout(r, 200));
  }
  throw new Error("server non pronto");
}
function browserPath() {
  const candidates = [
    process.env.MATHAPP_BROWSER,
    "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
    "C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe",
    "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
    "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe",
  ].filter(Boolean);
  return candidates.find((p) => fs.existsSync(p));
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
let ok = 0, fail = 0;
function chk(name, cond) { if (cond) { console.log("OK   " + name); ok++; } else { console.error("FAIL " + name); fail++; } }

let browser;
try {
  await waitReady(port);
  const exe = browserPath();
  if (!exe) {
    if (process.env.CI) throw new Error("browser non trovato in CI");
    console.log("SKIP: browser non trovato.");
    process.exit(0);
  }
  browser = await puppeteer.launch({ executablePath: exe, headless: "new", args: ["--no-sandbox", "--disable-gpu"] });
  const page = await browser.newPage();
  await page.setViewport({ width: 1100, height: 900 });
  await page.goto(`http://127.0.0.1:${port}/`, { waitUntil: "domcontentloaded", timeout: 30000 });
  await page.waitForFunction(() => !!window.__ggb, { timeout: 60000 });
  chk("applet GeoGebra caricata", await page.evaluate(() => !!window.__ggb));

  const built = await page.evaluate(async () => {
    const api = window.__ggb;
    api.evalCommand("A=(1,2)");
    const started = Date.now();
    while (!api.getAllObjectNames().includes("A") && Date.now() - started < 10000) await new Promise((r) => setTimeout(r, 100));
    const b64 = await new Promise((resolve) => api.getBase64(resolve));
    return { names: api.getAllObjectNames(), b64 };
  });
  chk("costruzione creata", built.names.includes("A"));
  chk("serializzazione base64", typeof built.b64 === "string" && built.b64.length > 1000);

  const stateId = "ggb-smoke-session";
  const saved = await request(port, "POST", "/api/conversation/state", {
    id: stateId, revision: 1, ggb: built.b64, cells: [], figures: [], mode: "figure", view3d: false,
    view: { xmin: -10, xmax: 10, ymin: -10, ymax: 10, axes: true, grid: false },
  });
  chk("stato GeoGebra salvato", saved.status === 200);

  await page.evaluate((id) => { localStorage.setItem("mathapp.conv", id); localStorage.setItem("mathapp.empty", "1"); }, stateId);
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.waitForFunction(() => !!window.__ggb, { timeout: 60000 });
  await page.waitForFunction(() => window.__ggb.getAllObjectNames().includes("A"), { timeout: 30000 });
  const rebuilt = await page.evaluate(() => window.__ggb.getAllObjectNames());
  chk("rebuild dopo reload", rebuilt.includes("A"));
} finally {
  if (browser) await browser.close();
  child.kill();
  await new Promise((r) => setTimeout(r, 500));
  try { fs.rmSync(tmp, { recursive: true, force: true }); } catch {}
}
console.log("----");
console.log(`OK=${ok} FAIL=${fail}`);
if (fail) { console.error(log.slice(-1200)); process.exit(1); }
