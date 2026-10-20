// Smoke browser minimo: UI, nuova chat, ripristino sessione/stato.
// Non richiede API key: usa solo HTTP locale + DOM.
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
    console.log("SKIP: puppeteer-core non installato (npm i --no-save puppeteer-core oppure MATHAPP_PUPPETEER).");
    process.exit(0);
  }
  const pkg = fs.existsSync(path.join(mod, "package.json"))
    ? path.join(mod, "lib", "puppeteer", "puppeteer-core.js")
    : mod;
  puppeteer = await import(pathToFileURL(pkg).href);
}

const root = path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1"));
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "mathapp-ui-"));
const settingsFile = path.join(tmp, "settings.json");
const authFile = path.join(tmp, "noauth.json");
const dataDir = path.join(tmp, "data");
const backupDir = path.join(tmp, "backups");
fs.writeFileSync(settingsFile, JSON.stringify({ provider: "openrouter", mode: "core", level: "dettagliato" }), "utf8");

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
  const base = `http://127.0.0.1:${port}/`;
  const stateId = "ui-smoke-session";
  const state = await request(port, "POST", "/api/conversation/state", {
    id: stateId, revision: 1, ggb: "", cells: [{ op: "diff", expr: "x^2", res: "2*x" }], figures: [],
    mode: "figure", view3d: false, view: { xmin: -5, xmax: 5, ymin: -5, ymax: 5, axes: true, grid: true },
  });
  chk("setup stato sessione", state.status === 200);

  browser = await puppeteer.launch({ executablePath: exe, headless: "new", args: ["--no-sandbox", "--disable-gpu"] });
  const page = await browser.newPage();
  await page.setViewport({ width: 1100, height: 900 });
  const pageErrors = [];
  page.on("pageerror", (e) => {
    const m = String(e && e.message || e);
    if (!/GGBApplet|ggb|Failed to load|net::/i.test(m)) pageErrors.push(m);
  });
  await page.goto(base, { waitUntil: "domcontentloaded", timeout: 30000 });
  await page.waitForSelector("#settingsBtn", { timeout: 15000 });
  chk("UI caricata", await page.$("#chat") !== null && await page.$("#ggb") !== null);
  const store = await page.evaluate(() => ({
    exists: !!window.MathAppState,
    domain: window.MathAppState && typeof window.MathAppState.domain === "object",
    ui: window.MathAppState && typeof window.MathAppState.ui === "object",
    conversationId: window.MathAppState && window.MathAppState.domain.conversationId,
    legacy: "messages" in window || "conversationId" in window,
  }));
  chk("state store domain/UI", store.exists && store.domain && store.ui && typeof store.conversationId === "string" && !store.legacy);

  const idBefore = await page.evaluate(() => localStorage.getItem("mathapp.conv"));
  await page.click("#newChat");
  await page.waitForFunction(() => document.querySelectorAll("#chat .msg").length === 0, { timeout: 5000 });
  const idAfter = await page.evaluate(() => localStorage.getItem("mathapp.conv"));
  chk("nuova chat azzera e cambia sessione", idAfter && idAfter !== idBefore);
  chk("welcome visibile dopo nuova chat", await page.evaluate(() => !document.getElementById("chatWelcome").hidden));

  await page.evaluate((id) => { localStorage.setItem("mathapp.conv", id); localStorage.setItem("mathapp.empty", "1"); }, stateId);
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.waitForFunction(() => document.querySelectorAll("#calcCells .cell").length > 0, { timeout: 10000 });
  await page.waitForFunction(() => document.getElementById("vxmin")?.value === "-5", { timeout: 10000 });
  const restored = await page.evaluate(() => ({
    cells: document.querySelectorAll("#calcCells .cell").length,
    expr: document.querySelector("#calcCells .cell-expr")?.textContent || "",
    xmin: document.getElementById("vxmin")?.value || "",
  }));
  chk("ripristino sessione: cella", restored.cells === 1 && restored.expr.includes("x^2"));
  chk("ripristino sessione: view", restored.xmin === "-5");

  const lazyCore = await page.evaluate(() => ({
    plugins: window.MathAppPlugins ? window.MathAppPlugins.loaded() : [],
    quiz: typeof window.__quiz,
    script: [...document.scripts].some((s) => s.src.includes("/features/quiz.js")),
  }));
  chk("core: plugin quiz non caricato", Array.isArray(lazyCore.plugins) && !lazyCore.plugins.includes("quiz") && lazyCore.quiz === "undefined" && !lazyCore.script);

  const toFull = await request(port, "POST", "/api/settings", { mode: "full" });
  chk("setup full", toFull.status === 200);
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.waitForFunction(() => !!window.__quiz, { timeout: 15000 });
  const lazyFull = await page.evaluate(() => ({ plugins: window.MathAppPlugins.loaded(), script: [...document.scripts].some((s) => s.src.includes("/features/quiz.js")) }));
  chk("full: plugin quiz caricato", lazyFull.plugins.includes("quiz") && lazyFull.script);

  chk("nessun errore JS dell'app", pageErrors.length === 0);
  if (pageErrors.length) console.error(pageErrors.slice(0, 4).join("\n"));
} finally {
  if (browser) await browser.close();
  child.kill();
  await new Promise((r) => setTimeout(r, 500));
  try { fs.rmSync(tmp, { recursive: true, force: true }); } catch {}
}
console.log("----");
console.log(`OK=${ok} FAIL=${fail}`);
if (fail) { console.error(log.slice(-1200)); process.exit(1); }
