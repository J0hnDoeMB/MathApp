import os from "node:os";
import path from "node:path";
// Verifica del laboratorio di analisi: studio di funzione con referto e Disegna,
// operazioni su vettori con disegno 2D/3D, Spiega sul referto.
import assert from "node:assert/strict";
import { createRequire } from "node:module";
let puppeteer;
try { puppeteer = createRequire(import.meta.url)("puppeteer"); }
catch { const alt = process.env.MATHAPP_PUPPETEER; if (!alt) throw new Error("Puppeteer non installato: esegui npm i -D puppeteer oppure imposta MATHAPP_PUPPETEER."); puppeteer = createRequire(alt)("puppeteer"); }

const CONV = "analisi-check";
const browser = await puppeteer.launch({ headless: "new", args: ["--no-sandbox", "--disable-gpu", "--enable-unsafe-swiftshader"] });
try {
  const page = await browser.newPage();
  await page.setViewport({ width: 1400, height: 900 });
  await page.evaluateOnNewDocument((conv) => {
    localStorage.setItem("mathapp.conv", conv);
    localStorage.setItem("mathapp.empty", "1");
  }, CONV);
  const explainRequests = [];
  await page.setRequestInterception(true);
  page.on("request", (r) => {
    if (r.url().includes("/api/conversation/state")) { r.continue(); return; }
    if (r.url().endsWith("/api/explain")) {
      explainRequests.push(JSON.parse(r.postData() || "{}"));
      r.respond({
        status: 200,
        headers: { "Content-Type": "text/event-stream; charset=utf-8" },
        body: 'event: delta\ndata: {"text":"La funzione si studia così: dominio, zeri, asintoti."}\n\n' + 'event: done\ndata: {}\n\n',
      });
      return;
    }
    r.continue();
  });
  await page.goto("http://127.0.0.1:8790/", { waitUntil: "domcontentloaded", timeout: 60000 });
  await page.waitForFunction(() => typeof window.setMode === "function", { timeout: 30000 });
  await page.waitForFunction(() => !!window.__ggb, { timeout: 60000 });
  await page.evaluate(() => window.setMode("algebra"));
  await new Promise((r) => setTimeout(r, 300));

  // ---------- studio di funzione: richiesta dal modulo ----------
  await page.evaluate(() => {
    document.querySelector("#calcExpr").value = "x^2-3x+2";
    document.querySelector("#calcOp").value = "studio";
    document.querySelector("#calcOp").dispatchEvent(new Event("change"));
    document.querySelector("#calcForm").requestSubmit();
  });
  let s = await page.evaluate(() => document.querySelector("#calcHint").textContent);
  assert.match(s, /f\(x\)=/, "il suggerimento cambia per lo studio di funzione");
  await page.waitForFunction(() => {
    const c = document.querySelector("#calcCells .cell");
    return c && c.querySelector(".cell-report") && c.querySelector(".cell-report").querySelectorAll("details").length >= 10;
  }, { timeout: 60000 });
  s = await page.evaluate(() => {
    const c = document.querySelector("#calcCells .cell");
    return {
      op: c.querySelector(".cell-op").textContent,
      sections: c.querySelector(".cell-report").querySelectorAll("details").length,
      labels: [...c.querySelectorAll(".cell-report summary")].map((x) => x.textContent).slice(0, 4),
      raw: c.querySelector(".cell-raw").textContent,
      actions: [...c.querySelectorAll(".cell-actions button")].map((b) => b.textContent),
      explain: !!c.querySelector(".cell-explain"),
      hint: document.querySelector("#calcHint").textContent,
    };
  });
  assert.equal(s.op, "studio di funzione");
  assert.equal(s.sections, 14, "quattordici sezioni del referto");
  assert.deepEqual(s.labels.slice(0, 3), ["Funzione", "Dominio", "Simmetrie"]);
  assert.match(s.raw, /zeri/, "il riepilogo cita gli zeri");
  assert.ok(s.actions.includes("📈 Disegna"), "pulsante Disegna presente");
  assert.equal(s.explain, true, "pulsante Spiega presente");

  // ---------- Disegna: curva + punti notevoli, inquadratura automatica ----------
  await page.evaluate(() => {
    const c = document.querySelector("#calcCells .cell");
    [...c.querySelectorAll(".cell-actions button")].find((b) => b.textContent.includes("Disegna")).click();
  });
  await page.waitForFunction(() => {
    try {
      const n = window.__ggb.getAllObjectNames();
      return n.includes("f") && n.includes("Z1") && n.includes("Z2") && n.includes("M1");
    } catch { return false; }
  }, { timeout: 30000 });
  await page.waitForFunction(() => {
    const r = window.viewFromBoard ? window.viewFromBoard() : null;
    return r && Math.abs(r.xmin + 1) < 0.05 && Math.abs(r.xmax - 3) < 0.05;
  }, { timeout: 15000 });
  s = await page.evaluate(() => {
    const r = window.viewFromBoard();
    const norm = (x) => String(window.__ggb.getCommandString(x) || "").replace(/\s+/g, "");
    return { r, Z1: norm("Z1"), M1: norm("M1"), names: window.__ggb.getAllObjectNames() };
  });
  assert.ok(Math.abs(s.r.xmin + 1) < 0.05 && Math.abs(s.r.xmax - 3) < 0.05, "la vista inquadra i punti notevoli (" + JSON.stringify(s.r) + ")");
  assert.ok(s.r.ymin < 0 && s.r.ymin > -1.5, "il minimo della funzione è inquadrato");
  assert.ok(s.r.ymax > 2.5 && s.r.ymax < 8, "anche la parte alta è inquadrata");
  assert.equal(s.Z1, "(1,0)", "lo zero Z1 è sul grafico");
  assert.equal(s.M1, "(1.5,-0.25)", "il vertice M1 è sul grafico");
  assert.ok(!s.names.includes("zzFit"), "la variabile di campionamento non resta sulla lavagna");

  // ---------- vettori: prodotto scalare in 2D ----------
  await page.evaluate(() => {
    document.querySelector("#calcExpr").value = "[[1,2],[3,4]]";
    document.querySelector("#calcOp").value = "dot";
    document.querySelector("#calcOp").dispatchEvent(new Event("change"));
    document.querySelector("#calcForm").requestSubmit();
  });
  await page.waitForFunction(() => {
    const c = [...document.querySelectorAll("#calcCells .cell")].find((x) => (x.querySelector(".cell-op") || {}).textContent === "prodotto scalare");
    return c && c.querySelector(".cell-raw") && c.querySelector(".cell-raw").textContent.includes("11");
  }, { timeout: 30000 });
  s = await page.evaluate(() => {
    const c = [...document.querySelectorAll("#calcCells .cell")].find((x) => (x.querySelector(".cell-op") || {}).textContent === "prodotto scalare");
    const sel = c.querySelector(".cell-actions select.draw-dim");
    return {
      hasSel: !!sel,
      options: sel ? [...sel.options].map((o) => o.value) : [],
      actions: [...c.querySelectorAll(".cell-actions button")].map((b) => b.textContent),
    };
  });
  assert.equal(s.hasSel, true, "c'è il selettore 2D/3D");
  assert.deepEqual(s.options, ["2d", "3d"], "2D e 3D disponibili");
  assert.ok(s.actions.includes("📈 Disegna"), "pulsante Disegna presente");
  await page.evaluate(() => {
    const c = [...document.querySelectorAll("#calcCells .cell")].find((x) => (x.querySelector(".cell-op") || {}).textContent === "prodotto scalare");
    [...c.querySelectorAll(".cell-actions button")].find((b) => b.textContent.includes("Disegna")).click();
  });
  await page.waitForFunction(() => {
    try { const n = window.__ggb.getAllObjectNames(); return n.includes("v1") && n.includes("v2"); } catch { return false; }
  }, { timeout: 30000 });
  await page.waitForFunction(() => {
    const r = window.viewFromBoard ? window.viewFromBoard() : null;
    return r && r.xmin < -0.5 && r.xmax > 3.5;
  }, { timeout: 15000 });
  s = await page.evaluate(() => {
    const r = window.viewFromBoard();
    return { xmin: r.xmin, xmax: r.xmax, v1: String(window.__ggb.getCommandString("v1") || "").replace(/\s+/g, "") };
  });
  assert.ok(s.xmin < -0.5 && s.xmax > 3.5, "la vista inquadra i vettori (" + JSON.stringify(s) + ")");
  assert.match(s.v1, /^(Vettore|Vector)\(\(0,0\),\(1,2\)\)$/, "v1 è davvero un vettore");

  // ---------- prodotto vettoriale: solo 3D, disegno nello spazio ----------
  await page.evaluate(() => {
    document.querySelector("#calcExpr").value = "[[1,0,0],[0,1,0]]";
    document.querySelector("#calcOp").value = "cross";
    document.querySelector("#calcOp").dispatchEvent(new Event("change"));
    document.querySelector("#calcForm").requestSubmit();
  });
  await page.waitForFunction(() => {
    const c = [...document.querySelectorAll("#calcCells .cell")].find((x) => (x.querySelector(".cell-op") || {}).textContent === "prodotto vettoriale");
    return c && (c.querySelector(".cell-raw") || {}).textContent;
  }, { timeout: 30000 });
  s = await page.evaluate(() => {
    const c = [...document.querySelectorAll("#calcCells .cell")].find((x) => (x.querySelector(".cell-op") || {}).textContent === "prodotto vettoriale");
    const sel = c.querySelector(".cell-actions select.draw-dim");
    return { options: [...sel.options].map((o) => o.value) };
  });
  assert.deepEqual(s.options, ["3d"], "il prodotto vettoriale è solo nello spazio");
  await page.evaluate(() => {
    const c = [...document.querySelectorAll("#calcCells .cell")].find((x) => (x.querySelector(".cell-op") || {}).textContent === "prodotto vettoriale");
    [...c.querySelectorAll(".cell-actions button")].find((b) => b.textContent.includes("Disegna")).click();
  });
  await page.waitForFunction(() => {
    try { const n = window.__ggb.getAllObjectNames(); return n.includes("v1") && n.includes("v2"); } catch { return false; }
  }, { timeout: 30000 });
  s = await page.evaluate(() => ({
    three: document.querySelector("#view3d").classList.contains("is-on"),
    v1: String(window.__ggb.getCommandString("v1") || "").replace(/\s+/g, ""),
  }));
  assert.equal(s.three, true, "il disegno 3D accende la vista tridimensionale");
  assert.match(s.v1, /^(Vettore|Vector)\(\(0,0,0\),/, "il vettore parte dall'origine nello spazio");

  // ---------- Spiega sul referto: passi le sezioni, non il solo riepilogo ----------
  await page.evaluate(() => {
    const c = [...document.querySelectorAll("#calcCells .cell")].find((x) => (x.querySelector(".cell-op") || {}).textContent === "studio di funzione");
    c.querySelector(".cell-explain").click();
  });
  await page.waitForFunction(() => {
    const b = document.querySelector(".cell-explain-box .explain-body");
    return b && b.textContent.includes("dominio");
  }, { timeout: 15000 });
  assert.equal(explainRequests.length, 1, "una richiesta di spiegazione");
  assert.match(explainRequests[0].result, /Dominio:/, "la spiegazione riceve le sezioni del referto");
  assert.match(explainRequests[0].result, /Zeri \(asse x\):/, "anche la sezione degli zeri");
  assert.match(explainRequests[0].latex, /x\^2|f\(x\)/, "il LaTeX accompagna la richiesta");

  // ---------- ritorno alla figura: la lavagna vera mostra il disegno ----------
  await page.evaluate(() => window.setMode("figure"));
  await page.waitForFunction(() => {
    return !!window.viewFromBoard() && (() => { try { return window.__ggb.getAllObjectNames().includes("v1"); } catch { return false; } })();
  }, { timeout: 30000 });
  s = await page.evaluate(() => ({
    visible: document.querySelector("#ggbwrap").offsetHeight > 0,
    three: document.querySelector("#view3d").classList.contains("is-on"),
  }));
  assert.equal(s.visible, true, "la lavagna è di nuovo visibile in modalità figura");
  assert.equal(s.three, true, "la vista 3D resta attiva");

  console.log("PASS: laboratorio di analisi (studio con referto 14 sezioni, Disegna con inquadratura, vettori 2D/3D, Spiega sul referto, ritorno alla figura)");
} finally {
  await browser.close();
  try { await fetch("http://127.0.0.1:8790/api/conversation?id=" + CONV, { method: "DELETE" }); } catch {}
}
