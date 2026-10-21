import os from "node:os";
import path from "node:path";
// Verifica funzionale del nuovo quaderno di algebra.
import assert from "node:assert/strict";
import { createRequire } from "node:module";
let puppeteer;
try { puppeteer = createRequire(import.meta.url)("puppeteer"); }
catch { const alt = process.env.MATHAPP_PUPPETEER; if (!alt) throw new Error("Puppeteer non installato: esegui npm i -D puppeteer oppure imposta MATHAPP_PUPPETEER."); puppeteer = createRequire(alt)("puppeteer"); }

const browser = await puppeteer.launch({ headless: "new", args: ["--no-sandbox", "--disable-gpu"] });
try {
  const page = await browser.newPage();
  await page.setViewport({ width: 1400, height: 900 });
  await page.evaluateOnNewDocument(() => {
    localStorage.setItem("mathapp.conv", "algebra-check");
    localStorage.setItem("mathapp.empty", "1");
  });
  const explainRequests = [];
  await page.setRequestInterception(true);
  page.on("request", (r) => {
    if (r.url().includes("/api/conversation/state")) { r.abort(); return; }
    if (r.url().endsWith("/api/explain")) {
      const body = JSON.parse(r.postData() || "{}");
      explainRequests.push(body);
      r.respond({
        status: 200,
        headers: { "Content-Type": "text/event-stream; charset=utf-8" },
        body: 'event: reasoning\ndata: {"text":"RAGIONAMENTO-SEGRETO"}\n\n' + 'event: delta\ndata: {"text":"Scomponiamo con la differenza di quadrati."}\n\n' + 'event: done\ndata: {}\n\n',
      });
      return;
    }
    r.continue();
  });
  await page.goto("http://127.0.0.1:8790/", { waitUntil: "domcontentloaded", timeout: 60000 });
  await page.waitForFunction(() => typeof window.setMode === "function", { timeout: 30000 });
  await page.evaluate(() => window.setMode("algebra"));
  await new Promise((r) => setTimeout(r, 400));

  // stato vuoto
  let s = await page.evaluate(() => ({
    emptyVisible: !document.querySelector("#calcEmpty").hidden,
    counter: document.querySelector("#calcCount").textContent,
    chips: document.querySelectorAll(".calc-examples button").length,
  }));
  assert.equal(s.emptyVisible, true, "stato vuoto visibile");
  assert.equal(s.counter, "nessun calcolo");
  assert.equal(s.chips, 4, "quattro esempi");

  // chip "Limite" -> calcola e verifica la voce
  await page.evaluate(() => document.querySelector('.calc-examples button[data-op="limit"]').click());
  await page.waitForFunction(() => document.querySelectorAll("#calcCells .cell").length === 1, { timeout: 30000 });
  await new Promise((r) => setTimeout(r, 500));
  s = await page.evaluate(() => {
    const c = document.querySelector("#calcCells .cell");
    return {
      emptyHidden: document.querySelector("#calcEmpty").hidden,
      counter: document.querySelector("#calcCount").textContent,
      n: c.querySelector(".cell-n").textContent,
      op: c.querySelector(".cell-op").textContent,
      opTransform: getComputedStyle(c.querySelector(".cell-op")).textTransform,
      expr: c.querySelector(".cell-expr").textContent,
      hasResult: !!c.querySelector(".cell-out .katex"),
      raw: c.querySelector(".cell-raw").textContent,
      actions: [...c.querySelectorAll(".cell-actions button")].map((b) => b.textContent),
      point: document.querySelector("#calcB").value,
    };
  });
  assert.equal(s.emptyHidden, true, "lo stato vuoto sparisce");
  assert.equal(s.counter, "1 calcolo");
  assert.equal(s.n, "01", "voce numerata 01");
  assert.equal(s.op, "limite");
  assert.equal(s.opTransform, "capitalize", "l'etichetta è resa con l'iniziale maiuscola");
  assert.equal(s.expr, "sin(x)/x");
  assert.equal(s.hasResult, true, "formula KaTeX nel riquadro risultato");
  assert.equal(s.raw, "1", "risultato esatto");
  assert.deepEqual(s.actions, ["→ calcolo", "→ chat"]);
  assert.equal(s.point, "0", "il punto del limite è impostato dal chip");

  // cella IA
  await page.evaluate(() => window.addCell("factor", "x^2-9", { ok: true, result: "(x - 3)*(x + 3)", latex: "\\left(x - 3\\right) \\left(x + 3\\right)" }, true, false));
  await new Promise((r) => setTimeout(r, 300));
  s = await page.evaluate(() => {
    const c = document.querySelector("#calcCells .cell");
    return { ai: c.classList.contains("cell-ai"), tag: (c.querySelector(".cell-tag") || {}).textContent, n: c.querySelector(".cell-n").textContent };
  });
  assert.equal(s.ai, true, "cella IA riconoscibile");
  assert.equal(s.tag, "IA");
  assert.equal(s.n, "01", "cella non registrata: numero coerente");

  // errore
  await page.evaluate(() => window.addCell("simplify", "2 +", { ok: false, error: "sintassi matematica non valida" }, false, false));
  await new Promise((r) => setTimeout(r, 300));
  s = await page.evaluate(() => {
    const c = document.querySelector("#calcCells .cell");
    return { err: !!c.querySelector(".cell-out.cell-err"), text: c.querySelector(".cell-out").textContent };
  });
  assert.equal(s.err, true, "cella errore evidenziata");
  assert.match(s.text, /Errore/);

  // → calcolo mette il risultato nella casella
  await page.evaluate(() => {
    const cells = [...document.querySelectorAll("#calcCells .cell")];
    const limit = cells[cells.length - 1];
    [...limit.querySelectorAll(".cell-actions button")].find((b) => b.textContent === "→ calcolo").click();
  });
  await new Promise((r) => setTimeout(r, 300));
  s = await page.evaluate(() => document.querySelector("#calcExpr").value);
  assert.equal(s, "1", "→ calcolo riporta il risultato nella casella");

  // ---------- riquadro "Spiega" (con /api/explain simulato) ----------
  await page.evaluate(() => {
    const c = [...document.querySelectorAll("#calcCells .cell")].pop();
    c.querySelector(".cell-explain").click();
  });
  await page.waitForFunction(() => {
    const b = document.querySelector(".cell-explain-box .explain-body");
    return b && b.textContent.includes("differenza di quadrati");
  }, { timeout: 15000 });
  s = await page.evaluate(() => {
    const box = document.querySelector(".cell-explain-box");
    return {
      title: box.querySelector(".explain-title").textContent,
      hasModes: !!box.querySelector(".explain-modes"),
      body: box.querySelector(".explain-body").textContent,
      leaked: box.querySelector(".explain-body").textContent.includes("RAGIONAMENTO-SEGRETO"),
      persisted: ((MathAppState.domain.cellData[MathAppState.domain.cellData.length - 1].spiega || {}).text || "").includes("differenza di quadrati"),
    };
  });
  assert.equal(s.title, "Spiegazione");
  assert.equal(s.hasModes, false, "un solo modo di spiegare: niente scelte");
  assert.match(s.body, /differenza di quadrati/);
  assert.equal(s.leaked, false, "il canale reasoning non finisce nel riquadro");
  assert.equal(s.persisted, true, "la spiegazione viene salvata nella voce");
  assert.equal(explainRequests.length, 1, "una sola richiesta di spiegazione");

  // chiudi
  await page.evaluate(() => document.querySelector(".cell-explain-box .explain-close").click());
  await new Promise((r) => setTimeout(r, 200));
  s = await page.evaluate(() => !!document.querySelector(".cell-explain-box"));
  assert.equal(s, false, "la ✕ chiude il riquadro");

  // ---------- operazioni matrici, ordine e scorciatoie ----------
  await page.evaluate(() => {
    document.querySelector("#calcExpr").value = "[[1,2],[3,4]]";
    document.querySelector("#calcOp").value = "det";
    document.querySelector("#calcForm").requestSubmit();
  });
  await page.waitForFunction(() => [...document.querySelectorAll("#calcCells .cell")].some((c) => (c.querySelector(".cell-raw") || {}).textContent === "-2"), { timeout: 30000 });
  s = await page.evaluate(() => {
    const c = [...document.querySelectorAll("#calcCells .cell")].find((x) => (x.querySelector(".cell-raw") || {}).textContent === "-2");
    return { op: c.querySelector(".cell-op").textContent, expr: c.querySelector(".cell-expr").textContent };
  });
  assert.equal(s.op, "determinante", "operazione matrice riconosciuta");
  assert.equal(s.expr, "[[1,2],[3,4]]");

  await page.evaluate(() => {
    document.querySelector("#calcExpr").value = "x^3";
    document.querySelector("#calcOp").value = "diff";
    document.querySelector("#calcOp").dispatchEvent(new Event("change"));
    document.querySelector("#calcOrder").value = "2";
    document.querySelector("#calcForm").requestSubmit();
  });
  await page.waitForFunction(() => [...document.querySelectorAll("#calcCells .cell")].some((c) => /6\*?x/.test((c.querySelector(".cell-raw") || {}).textContent || "")), { timeout: 30000 });
  s = await page.evaluate(() => !document.querySelector("#labOrder").hidden);
  assert.equal(s, true, "il campo ordine appare per la derivata");

  await page.evaluate(() => { document.querySelector("#calcExpr").value = ""; document.querySelector("#calcExpr").focus(); });
  await page.keyboard.press("ArrowUp");
  s = await page.evaluate(() => document.querySelector("#calcExpr").value);
  assert.equal(s, "x^3", "↑ richiama l'ultima espressione");

  await page.evaluate(() => {
    document.querySelector("#calcExpr").value = "";
    const c = [...document.querySelectorAll("#calcCells .cell")].find((x) => (x.querySelector(".cell-raw") || {}).textContent === "-2");
    c.querySelector(".cell-expr").click();
  });
  s = await page.evaluate(() => ({ expr: document.querySelector("#calcExpr").value, op: document.querySelector("#calcOp").value }));
  assert.equal(s.expr, "[[1,2],[3,4]]", "cliccando l'espressione torna nel modulo");
  assert.equal(s.op, "det");

  console.log("PASS: quaderno di algebra (stato vuoto, chip, voce numerata, IA, errore, azioni, Spiega, matrici, ordine, scorciatoie)");
} finally {
  await browser.close();
}
