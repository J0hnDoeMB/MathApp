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

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1")), "..");
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
    "/usr/bin/google-chrome",
    "/usr/bin/google-chrome-stable",
    "/usr/bin/chromium",
    "/usr/bin/chromium-browser",
    "/opt/google/chrome/chrome",
  ].filter(Boolean);
  return candidates.find((p) => fs.existsSync(p));
}

const port = await freePort();
const child = spawn(process.execPath, ["server.mjs"], {
  cwd: root,
  env: { ...process.env, MATHAPP_PORT: String(port), MATHAPP_SETTINGS_FILE: settingsFile, MATHAPP_AUTH_FILE: authFile, MATHAPP_DATA_DIR: dataDir, MATHAPP_BACKUP_DIR: backupDir, MATHAPP_NO_WHISPER: "1", MATHAPP_TEST_SHUTDOWN: "1" },
  stdio: ["ignore", "pipe", "pipe"],
  windowsHide: true,
});
let log = "";
child.stdout.on("data", (c) => (log += c));
child.stderr.on("data", (c) => (log += c));
let ok = 0, fail = 0;
function chk(name, cond, detail) { if (cond) { console.log("OK   " + name); ok++; } else { console.error("FAIL " + name + (detail ? " " + detail : "")); fail++; } }

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

  browser = await puppeteer.launch({ executablePath: exe, headless: "new", args: ["--no-sandbox", "--disable-gpu", "--disable-dev-shm-usage"] });
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
  chk("service worker registrato", await page.waitForFunction(
    () => navigator.serviceWorker.getRegistration().then(Boolean).catch(() => false),
    { timeout: 5000 },
  ).then(() => true).catch(() => false));
  await page.keyboard.press("Tab");
  const skip = await page.evaluate(async () => {
    const a = document.querySelector('a.skip-link[href="#main"]');
    if (!a) return null;
    await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
    const r = a.getBoundingClientRect();
    const style = getComputedStyle(a);
    return {
      visible: r.top >= 0 && r.height > 0 && r.width > 0,
      target: !!document.querySelector("#main"),
      focused: document.activeElement === a,
      top: style.top,
      position: style.position,
    };
  });
  chk("skip link accessibile", !!skip && skip.visible && skip.target && skip.focused, JSON.stringify(skip));
  const store = await page.evaluate(() => ({
    exists: !!window.MathAppState,
    domain: window.MathAppState && typeof window.MathAppState.domain === "object",
    ui: window.MathAppState && typeof window.MathAppState.ui === "object",
    conversationId: window.MathAppState && window.MathAppState.domain.conversationId,
    legacy: "messages" in window || "conversationId" in window,
  }));
  chk("state store domain/UI", store.exists && store.domain && store.ui && typeof store.conversationId === "string" && !store.legacy);
  const commands = await page.evaluate(() => window.MathAppState.commands());
  chk("command bus UI -> application", ["session.new", "chat.send", "session.restore", "settings.open", "settings.toggle", "settings.save", "settings.clearKey", "settings.close", "view.mode", "view.toggle3d", "chat.stop", "chat.regenerate", "theme.toggle", "tutor.toggle", "tutor.off", "history.toggle", "history.close", "history.search", "conversation.open", "conversation.delete", "backup.create", "export.pdf", "export.markdown", "export.notebook", "diagnostics.refresh", "model.select"].every((c) => commands.includes(c)));

  const busEvents = await page.evaluate(async () => {
    const seen = [];
    const off = [
      MathAppState.on("command:test.ok", () => seen.push("start")),
      MathAppState.on("command:done:test.ok", () => seen.push("done")),
      MathAppState.on("command:error:test.fail", () => seen.push("error")),
    ];
    MathAppState.handle("test.ok", () => ({ ok: true }));
    MathAppState.handle("test.fail", () => { throw new Error("boom"); });
    await MathAppState.dispatch("test.ok");
    try { await MathAppState.dispatch("test.fail"); } catch {}
    off.forEach((fn) => fn());
    return seen;
  });
  chk("command bus lifecycle events", busEvents.join(",") === "start,done,error");

  const themeBefore = await page.evaluate(() => document.body.classList.contains("theme-dark"));
  await page.click("#themeBtn");
  const themeAfter = await page.evaluate(() => document.body.classList.contains("theme-dark"));
  chk("command theme.toggle", themeAfter !== themeBefore);
  await page.click("#themeBtn");

  await page.evaluate(() => window.MathAppState.dispatch("tutor.toggle", { mode: "socratic" }));
  const tutorOn = await page.evaluate(() => window.MathAppState.domain.tutorMode);
  await page.evaluate(() => window.MathAppState.dispatch("tutor.off"));
  const tutorOff = await page.evaluate(() => window.MathAppState.domain.tutorMode);
  chk("command tutor.toggle/off", tutorOn === "socratic" && tutorOff === null);

  await page.evaluate(() => window.MathAppState.dispatch("history.toggle"));
  await page.waitForFunction(() => !document.querySelector("#historyDrawer").hidden, { timeout: 5000 });
  chk("command history.toggle", true);
  await page.evaluate(() => window.MathAppState.dispatch("history.close"));
  await page.waitForFunction(() => document.querySelector("#historyDrawer").hidden, { timeout: 5000 });

  await page.evaluate(() => window.MathAppState.dispatch("settings.open"));
  await page.waitForFunction(() => !document.querySelector("#settingsDrawer").hidden, { timeout: 5000 });
  chk("command settings.open", true);
  await page.click("#settingsClose");

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
  chk("core: plugin UI non caricati", Array.isArray(lazyCore.plugins) && !lazyCore.plugins.includes("quiz") && !lazyCore.plugins.includes("review") && !lazyCore.plugins.includes("tts") && !lazyCore.plugins.includes("kb") && !lazyCore.plugins.includes("style") && lazyCore.quiz === "undefined" && !lazyCore.script);

  const toFull = await request(port, "POST", "/api/settings", { mode: "full" });
  chk("setup full", toFull.status === 200);
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.waitForFunction(() => !!window.__quiz && ["review", "tts", "kb", "style"].every((id) => window.MathAppPlugins.has(id)), { timeout: 15000 });
  const lazyFull = await page.evaluate(() => ({ plugins: window.MathAppPlugins.loaded(), script: [...document.scripts].some((s) => s.src.includes("/features/quiz.js")), review: !!MathAppPlugins.api("review"), tts: !!MathAppPlugins.api("tts"), kb: !!MathAppPlugins.api("kb"), style: !!MathAppPlugins.api("style") }));
  chk("full: plugin UI caricati", lazyFull.plugins.includes("quiz") && lazyFull.plugins.includes("review") && lazyFull.plugins.includes("tts") && lazyFull.plugins.includes("kb") && lazyFull.plugins.includes("style") && lazyFull.script && lazyFull.review && lazyFull.tts && lazyFull.kb && lazyFull.style);
  await page.click("#reviewBtn");
  await page.waitForFunction(() => !document.querySelector("#reviewDrawer").hidden, { timeout: 5000 });
  chk("full: drawer Ripasso", true);
  await page.click("#reviewClose");
  await page.click("#kbBtn");
  await page.waitForFunction(() => !document.querySelector("#kbDrawer").hidden, { timeout: 5000 });
  chk("full: drawer Appunti", true);
  await page.click("#kbClose");
  await page.click("#styleBtn");
  await page.waitForFunction(() => !document.querySelector("#styleDrawer").hidden, { timeout: 5000 });
  chk("full: drawer Stile", true);
  await page.click("#styleClose");

  await page.setViewport({ width: 390, height: 844 });
  await new Promise((r) => setTimeout(r, 300));
  const mobile = await page.evaluate(async () => {
    const prompt = document.querySelector("#input");
    if (prompt) prompt.scrollIntoView({ block: "center" });
    await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
    const rect = prompt ? prompt.getBoundingClientRect() : null;
    return {
      overflow: document.documentElement.scrollWidth - window.innerWidth,
      promptVisible: !!rect && rect.width > 100 && rect.bottom <= window.innerHeight + 2 && rect.top >= -2,
      width: rect ? Math.round(rect.width) : 0,
    };
  });
  chk("mobile: nessun overflow e prompt visibile", mobile.overflow <= 1 && mobile.promptVisible, JSON.stringify(mobile));

  chk("nessun errore JS dell'app", pageErrors.length === 0);
  if (pageErrors.length) console.error(pageErrors.slice(0, 4).join("\n"));

  await page.evaluate(() => navigator.serviceWorker.ready);
  await page.reload({ waitUntil: "domcontentloaded", timeout: 30000 });
  await page.setOfflineMode(true);
  await page.reload({ waitUntil: "domcontentloaded", timeout: 30000 });
  const offlineShell = await page.evaluate(() => ({
    shell: !!document.querySelector("#chat") && !!window.MathAppFormat && !!window.MathAppMarkdown,
    markdown: !!window.marked,
    katex: !!window.katex,
    geogebra: typeof window.GGBApplet === "function",
  }));
  chk("offline: shell servita dalla cache", offlineShell.shell && offlineShell.markdown && offlineShell.katex && offlineShell.geogebra, JSON.stringify(offlineShell));
  await page.setOfflineMode(false);
} finally {
  if (browser) await browser.close();
  try { await fetch(`http://127.0.0.1:${port}/__test_shutdown`, { method: "POST", signal: AbortSignal.timeout(1000) }); } catch {}
  await new Promise((r) => setTimeout(r, 600));
  if (child.exitCode === null) child.kill();
  await new Promise((r) => setTimeout(r, 300));
  try { fs.rmSync(tmp, { recursive: true, force: true }); } catch {}
}
console.log("----");
console.log(`OK=${ok} FAIL=${fail}`);
if (fail) { console.error(log.slice(-1200)); process.exit(1); }
