// Browser regression: untrusted Markdown/tool/LaTeX cannot execute or inject HTML.
// Starts its own server and uses no API key.
import { spawn } from "node:child_process";
import http from "node:http";
import net from "node:net";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { createRequire } from "node:module";
import assert from "node:assert/strict";

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
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "mathapp-xss-"));
const settingsFile = path.join(tmp, "settings.json");
const authFile = path.join(tmp, "noauth.json");
fs.writeFileSync(settingsFile, JSON.stringify({ provider: "openrouter", mode: "core", level: "dettagliato" }), "utf8");

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
      let b = "";
      res.on("data", (c) => (b += c));
      res.on("end", () => resolve({ status: res.statusCode, body: b }));
    });
    req.on("error", reject);
    req.end();
  });
}
async function waitReady(port, child) {
  for (let i = 0; i < 60; i++) {
    if (child.exitCode !== null) throw new Error("server exited early");
    try { if ((await request(port, "GET", "/api/settings")).status === 200) return; } catch {}
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
  env: {
    ...process.env,
    MATHAPP_PORT: String(port),
    MATHAPP_SETTINGS_FILE: settingsFile,
    MATHAPP_AUTH_FILE: authFile,
    MATHAPP_DATA_DIR: path.join(tmp, "data"),
    MATHAPP_BACKUP_DIR: path.join(tmp, "backups"),
    MATHAPP_TRACE_DIR: path.join(tmp, "logs"),
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
let checks = 0;
function chk(name, cond) {
  if (cond) { console.log("OK   " + name); checks++; }
  else { console.error("FAIL " + name); process.exitCode = 1; }
}

try {
  await waitReady(port, child);
  const exe = browserPath();
  if (!exe) {
    if (process.env.CI) throw new Error("browser non trovato in CI");
    console.log("SKIP: browser non trovato.");
  } else {
  browser = await puppeteer.launch({ executablePath: exe, headless: "new", args: ["--no-sandbox", "--disable-gpu", "--disable-dev-shm-usage"] });
  const page = await browser.newPage();
  await page.evaluateOnNewDocument(() => {
    localStorage.setItem("mathapp.conv", "xss-regression-probe");
    localStorage.setItem("mathapp.empty", "1");
  });
  await page.setRequestInterception(true);
  page.on("request", (request) => {
    if (request.url().endsWith("/api/chat")) {
      const tool = {
        name: '<img src="/mathapp-xss-tool-missing.png" onerror="window.__mathappToolProbe++">',
        args: { note: '<img src="/mathapp-xss-args-missing.png" onerror="window.__mathappToolProbe++">' },
      };
      const edit = {
        callId: "xss-test",
        ops: [{ op: "not-real", note: "</code><img src=/mathapp-xss-edit-missing.png onerror=window.__mathappToolProbe++><code>" }],
      };
      const body =
        "event: tool\ndata: " + JSON.stringify(tool) + "\n\n" +
        "event: geogebra_edit\ndata: " + JSON.stringify(edit) + "\n\n" +
        'event: delta\ndata: {"text":"Risposta di prova"}\n\n';
      request.respond({ status: 200, headers: { "Content-Type": "text/event-stream; charset=utf-8" }, body });
    } else if (request.url().includes("/api/conversation/state")) {
      request.abort();
    } else {
      request.continue();
    }
  });
  await page.goto("http://127.0.0.1:" + port + "/", { waitUntil: "domcontentloaded", timeout: 60000 });
  await page.waitForFunction(
    () => !!window.marked && !!window.katex && typeof window.renderMathInElement === "function" && typeof window.renderMD === "function",
    { timeout: 30000 },
  );

  const result = await page.evaluate(async () => {
    window.__mathappXssProbe = 0;
    const host = document.createElement("div");
    document.body.appendChild(host);
    window.renderMD(
      host,
      '<p>testo <strong>sicuro</strong></p>' +
        '<img src="/mathapp-xss-probe-missing.png" onerror="window.__mathappXssProbe++">' +
        '<script>window.__mathappXssProbe += 10</script>' +
        '<a href="javascript:window.__mathappXssProbe++">link</a>',
    );
    await new Promise((resolve) => setTimeout(resolve, 500));
    const state = {
      executed: window.__mathappXssProbe,
      hasImage: !!host.querySelector("img"),
      hasEventHandler: !!host.querySelector("[onerror], [onclick]"),
      hasScript: !!host.querySelector("script"),
      unsafeHref: !!host.querySelector('a[href^="javascript:"]'),
      keepsMarkdown: !!host.querySelector("strong"),
    };
    host.remove();
    return state;
  });

  chk("Markdown ostile non esegue JavaScript", result.executed === 0);
  chk("Markdown ostile non inserisce immagini", result.hasImage === false);
  chk("Markdown ostile non inserisce handler", result.hasEventHandler === false);
  chk("Markdown ostile non inserisce script", result.hasScript === false);
  chk("Markdown ostile non mantiene javascript:", result.unsafeHref === false);
  chk("Markdown legittimo resta formattato", result.keepsMarkdown === true);

  await page.evaluate(() => {
    window.__mathappToolProbe = 0;
    return window.send("prova XSS nei dettagli tool");
  });
  const toolResult = await page.evaluate(() => ({
    executed: window.__mathappToolProbe,
    hasImage: !!document.querySelector(".tools img"),
    hasEventHandler: !!document.querySelector(".tools [onerror], .tools [onclick]"),
  }));
  chk("tool ostile non esegue JavaScript", toolResult.executed === 0);
  chk("tool ostile non inserisce immagini", toolResult.hasImage === false);
  chk("tool ostile non inserisce handler", toolResult.hasEventHandler === false);

  const cellResult = await page.evaluate(async () => {
    window.__mathappCellProbe = 0;
    window.addCell("latex", "prova", {
      latex: '<img src="/mathapp-xss-cell-missing.png" onerror="window.__mathappCellProbe++">',
      result: "",
    }, false, false);
    await new Promise((resolve) => setTimeout(resolve, 500));
    return {
      executed: window.__mathappCellProbe,
      hasImage: !!document.querySelector("#calcCells img"),
      hasEventHandler: !!document.querySelector("#calcCells [onerror], #calcCells [onclick]"),
    };
  });
  chk("LaTeX ostile non esegue JavaScript", cellResult.executed === 0);
  chk("LaTeX ostile non inserisce immagini", cellResult.hasImage === false);
  chk("LaTeX ostile non inserisce handler", cellResult.hasEventHandler === false);

  const formulaResult = await page.evaluate(() => {
    window.addCell("factor", "x^2", { result: "x**2", latex: "x^{2}" }, false, false);
    const output = document.querySelector("#calcCells .cell-out");
    const markdown = document.createElement("div");
    window.renderMD(markdown, "$$x^2$$");
    return {
      cellKatex: !!output.querySelector(".katex"),
      markdownKatex: !!markdown.querySelector(".katex"),
    };
  });
  chk("Le formule calcolate restano KaTeX", formulaResult.cellKatex === true);
  chk("Le formule Markdown restano KaTeX", formulaResult.markdownKatex === true);
  }
} finally {
  if (browser) await browser.close();
  try { await request(port, "POST", "/__test_shutdown"); } catch {}
  await new Promise((r) => setTimeout(r, 600));
  if (child.exitCode === null) child.kill();
  await new Promise((r) => setTimeout(r, 300));
  try { fs.rmSync(tmp, { recursive: true, force: true }); } catch {}
}
console.log("----");
console.log("OK=" + checks + (process.exitCode ? " FAIL" : ""));
if (process.exitCode && log) console.error(log.slice(-1200));
