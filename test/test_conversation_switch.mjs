// Self-contained browser regression: a cancelled stream must not leak into the
// conversation opened immediately afterwards. No app running and no API key.
import { spawn } from "node:child_process";
import fs from "node:fs";
import http from "node:http";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath, pathToFileURL } from "node:url";

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

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "mathapp-switch-"));
const settingsFile = path.join(tmp, "settings.json");
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
function request(port, method, pathname) {
  return new Promise((resolve, reject) => {
    const req = http.request({ host: "127.0.0.1", port, method, path: pathname }, (res) => {
      res.resume();
      res.on("end", () => resolve(res.statusCode));
    });
    req.on("error", reject);
    req.end();
  });
}
async function waitReady(port) {
  for (let i = 0; i < 60; i++) {
    try { if (await request(port, "GET", "/api/settings") === 200) return; } catch {}
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

const exe = browserPath();
if (!exe) {
  if (process.env.CI) throw new Error("browser non trovato in CI");
  console.log("SKIP: browser non trovato.");
  process.exit(0);
}

const port = await freePort();
const child = spawn(process.execPath, ["server.mjs"], {
  cwd: root,
  env: {
    ...process.env,
    MATHAPP_PORT: String(port),
    MATHAPP_SETTINGS_FILE: settingsFile,
    MATHAPP_DATA_DIR: dataDir,
    MATHAPP_BACKUP_DIR: backupDir,
    MATHAPP_NO_WHISPER: "1",
    MATHAPP_TEST_SHUTDOWN: "1",
  },
  stdio: ["ignore", "pipe", "pipe"],
  windowsHide: true,
});
let log = "";
child.stdout.on("data", (c) => (log += c));
child.stderr.on("data", (c) => (log += c));

let browser;
try {
  await waitReady(port);
  browser = await puppeteer.launch({ executablePath: exe, headless: "new", args: ["--no-sandbox", "--disable-gpu", "--disable-dev-shm-usage"] });
  const page = await browser.newPage();
  await page.evaluateOnNewDocument(() => {
    localStorage.setItem("mathapp.conv", "empty-probe");
    localStorage.setItem("mathapp.empty", "1");
  });

  let firstChatRequest = null;
  let secondChatBody = null;
  let chatCount = 0;
  await page.setRequestInterception(true);
  page.on("request", (request) => {
    const url = new URL(request.url());
    if (url.pathname === "/api/chat") {
      chatCount++;
      if (chatCount === 1) {
        firstChatRequest = request; // resta sospesa per simulare una risposta in streaming
      } else {
        secondChatBody = JSON.parse(request.postData());
        request.respond({
          status: 200,
          headers: { "Content-Type": "text/event-stream; charset=utf-8" },
          body: 'event: delta\ndata: {"text":"risposta nuova"}\n\n',
        });
      }
    } else if (url.pathname === "/api/conversation" && url.searchParams.get("id") === "history-probe") {
      request.respond({
        status: 200,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          id: "history-probe", messages: [
            { role: "user", content: "messaggio storico" },
            { role: "assistant", content: "risposta storica" },
          ],
          cells: [], figures: [], ggb: null, mode: "figure",
        }),
      });
    } else if (url.pathname === "/api/conversation/state") {
      request.respond({ status: 200, headers: { "Content-Type": "application/json" }, body: '{"ok":true}' });
    } else {
      request.continue();
    }
  });

  await page.goto(`http://127.0.0.1:${port}/`, { waitUntil: "domcontentloaded", timeout: 60000 });
  await page.waitForFunction(() => typeof window.send === "function" && typeof window.openConv === "function", { timeout: 30000 });
  await page.evaluate(() => window.__ggbResolve({}));
  await page.evaluate(() => { void window.send("domanda nella chat precedente"); });
  const deadline = Date.now() + 10000;
  while (!firstChatRequest && Date.now() < deadline) await new Promise((resolve) => setTimeout(resolve, 50));
  if (!firstChatRequest) throw new Error("la prima richiesta chat non è partita");

  await page.evaluate(() => window.openConv("history-probe"));
  try {
    await firstChatRequest.respond({
      status: 200,
      headers: { "Content-Type": "text/event-stream; charset=utf-8" },
      body: 'event: delta\ndata: {"text":"risposta tardiva della chat precedente"}\n\n',
    });
  } catch { /* L'annullamento corretto può chiudere la richiesta. */ }
  await page.waitForFunction(() => document.querySelector("#send").textContent === "Invia", { timeout: 10000 });

  await page.evaluate(() => window.send("domanda nella chat storica"));
  await page.waitForFunction(() => !!document.querySelector(".msg.assistant .msg-body")?.textContent.includes("risposta nuova"), { timeout: 10000 });
  if (!secondChatBody) throw new Error("la seconda richiesta chat non è partita");
  if (secondChatBody.messages.some((message) => String(message.content || "").includes("risposta tardiva"))) {
    throw new Error("una risposta tardiva è finita nella conversazione appena aperta");
  }
  const contents = secondChatBody.messages.map((message) => message.content);
  if (JSON.stringify(contents) !== JSON.stringify(["messaggio storico", "risposta storica", "domanda nella chat storica"])) {
    throw new Error("contesto conversazione errato: " + JSON.stringify(contents));
  }
  console.log("PASS: uno stream annullato non contamina la conversazione successiva");
} catch (e) {
  console.error("FAIL: " + e.message);
  if (log) console.error(log.slice(-1200));
  process.exitCode = 1;
} finally {
  if (browser) await browser.close();
  try { await fetch(`http://127.0.0.1:${port}/__test_shutdown`, { method: "POST", signal: AbortSignal.timeout(1000) }); } catch {}
  await new Promise((r) => setTimeout(r, 600));
  if (child.exitCode === null) child.kill();
  await new Promise((r) => setTimeout(r, 300));
  try { fs.rmSync(tmp, { recursive: true, force: true }); } catch {}
}
