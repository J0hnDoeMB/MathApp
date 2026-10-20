import os from "node:os";
import path from "node:path";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import fs from "node:fs/promises";

let puppeteer;
try { puppeteer = createRequire(import.meta.url)("puppeteer"); }
catch { const alt = process.env.MATHAPP_PUPPETEER; if (!alt) throw new Error("Puppeteer non installato: esegui npm i -D puppeteer oppure imposta MATHAPP_PUPPETEER."); puppeteer = createRequire(alt)("puppeteer"); }
const appSource = await fs.readFile(new URL("./public/app.js", import.meta.url), "utf8");
const fakeGgb = `
window.__ggbLoadLog = [];
window.GGBApplet = class {
  constructor(params) {
    this.params = params;
    this.api = {
      objects: [],
      getAllObjectNames() { return this.objects.slice(); },
      getBase64(callback) {
        if (typeof callback === "function") { setTimeout(() => callback("CURRENT_BASE64"), 20); return; }
        return "CURRENT_BASE64";
      },
      setBase64(value, callback) {
        const entry = { value, callbackProvided: typeof callback === "function", finished: false };
        window.__ggbLoadLog.push(entry);
        setTimeout(() => { this.objects = ["restored:" + value]; entry.finished = true; if (callback) callback(); }, 300);
      },
      newConstruction() { this.objects = []; },
      evalCommand(command) { this.objects.push("command:" + command); return true; },
      getXML() { return "<geogebra><gui></gui></geogebra>"; },
      setXML() {}, setSize() {}, refreshViews() {},
      setPerspective(p) { window.__ggbPerspective = p; },
    };
  }
  inject() { this.params.appletOnLoad(this.api); }
};
`;
const savedConversation = {
  id: "history-probe",
  title: "Prova ripristino storico",
  model: "deepseek-v4.1-flash",
  messages: [
    { role: "user", content: "domanda storica" },
    { role: "assistant", content: "risposta storica" },
  ],
  cells: [{
    op: "factor",
    expr: "x^2-9",
    res: { ok: true, result: "(x - 3)*(x + 3)", latex: "\\left(x - 3\\right) \\left(x + 3\\right)" },
    ai: false,
    spiega: { text: "Scomponiamo con la **differenza di quadrati**." },
  }],
  figures: [{ fid: "fig-history-probe", title: "Cerchio storico", commands: ["A=(0,0)"], msgIdx: 1 }],
  mode: "algebra",
  ggb: "BASE64_TARGET",
  view3d: true,
};

const browser = await puppeteer.launch({ headless: "new", args: ["--no-sandbox", "--disable-gpu"] });
try {
  const page = await browser.newPage();
  await page.evaluateOnNewDocument(() => {
    localStorage.setItem("mathapp.conv", "empty-probe");
    localStorage.setItem("mathapp.empty", "1");
  });
  let firstStateWriteSeen = false;
  let firstStateWriteFinished = false;
  let historyReadAfterStateFlush = null;
  await page.setRequestInterception(true);
  page.on("request", (request) => {
    const url = new URL(request.url());
    if (url.pathname === "/app.js") {
      request.respond({
        status: 200,
        headers: { "Content-Type": "text/javascript; charset=utf-8", "Cache-Control": "no-cache" },
        body: fakeGgb + "\n" + appSource,
      });
    } else if (url.pathname === "/api/conversation" && url.searchParams.get("id") === "history-probe") {
      historyReadAfterStateFlush = firstStateWriteFinished;
      request.respond({
        status: 200,
        headers: { "Content-Type": "application/json", "Cache-Control": "no-cache" },
        body: JSON.stringify(savedConversation),
      });
    } else if (url.pathname === "/api/conversation/state") {
      if (!firstStateWriteSeen) {
        firstStateWriteSeen = true;
        setTimeout(() => {
          firstStateWriteFinished = true;
          request.respond({ status: 200, headers: { "Content-Type": "application/json" }, body: '{"ok":true}' });
        }, 250);
      } else {
        request.respond({ status: 200, headers: { "Content-Type": "application/json" }, body: '{"ok":true}' });
      }
    } else {
      request.continue();
    }
  });

  await page.goto("http://127.0.0.1:8790/", { waitUntil: "domcontentloaded", timeout: 60000 });
  await page.waitForFunction(() => typeof window.openConv === "function" && !!window.__ggb, { timeout: 30000 });
  await page.waitForFunction(() => window.MathAppState && window.MathAppState.ui.booting === false, { timeout: 30000 });
  await page.evaluate(() => window.openConv("history-probe"));

  const state = await page.evaluate(() => ({
    id: localStorage.getItem("mathapp.conv"),
    messageText: document.querySelector("#chat").textContent,
    cells: document.querySelectorAll("#calcCells .cell").length,
    explain: (document.querySelector(".cell-explain-box .explain-body") || {}).textContent || "",
    figures: [...document.querySelectorAll("#chat .ggb-card b")].map((el) => el.textContent),
    algebraMode: !document.querySelector("#panelAlgebra").hidden,
    viewOn: document.querySelector("#view3d").classList.contains("is-on"),
    perspective: window.__ggbPerspective || null,
    firstLoad: window.__ggbLoadLog[0] || null,
    objects: window.__ggb.getAllObjectNames(),
  }));

  assert.equal(state.id, savedConversation.id, "la sessione aperta deve diventare quella persistita");
  assert.equal(historyReadAfterStateFlush, true, "il salvataggio della vista precedente deve finire prima di caricare lo storico");
  assert.match(state.messageText, /domanda storica/);
  assert.match(state.messageText, /risposta storica/);
  assert.equal(state.cells, 1, "i calcoli salvati devono essere ripristinati");
  assert.match(state.explain, /differenza di quadrati/, "la spiegazione salvata deve riaprirsi con la voce");
  assert.deepEqual(state.figures, ["Cerchio storico"], "le costruzioni salvate devono essere ripristinate");
  assert.equal(state.algebraMode, true, "la modalità salvata deve essere ripristinata");
  assert.equal(state.viewOn, true, "la vista 3D salvata deve essere ripristinata");
  assert.equal(state.perspective, "+T", "la prospettiva 3D viene riapplicata alla lavagna");

  assert.equal(state.firstLoad.callbackProvided, true, "setBase64 deve ricevere il callback di completamento");
  assert.equal(state.firstLoad.finished, true, "openConv deve attendere la fine del caricamento GeoGebra");
  assert.deepEqual(state.objects, ["restored:BASE64_TARGET"], "lo stato esatto deve prevalere sulla ricostruzione anticipata dei comandi");

  const previousLoads = await page.evaluate(() => window.__ggbLoadLog.length);
  await page.evaluate(() => { void window.openConv("history-probe"); });
  await page.waitForFunction((n) => window.__ggbLoadLog.length > n, { timeout: 10000 }, previousLoads);
  await page.click("#newChat");
  await new Promise((resolve) => setTimeout(resolve, 500));
  const afterNew = await page.evaluate(() => ({
    objects: window.__ggb.getAllObjectNames(),
    text: document.querySelector("#chat").textContent,
  }));
  assert.deepEqual(afterNew.objects, [], "un caricamento GeoGebra tardivo non deve ripopolare una Nuova chat");
  assert.doesNotMatch(afterNew.text, /domanda storica|risposta storica/);
  console.log("PASS: lo storico ripristina conversazione, calcoli, figure e modalità", state);
} finally {
  await browser.close();
}
