import os from "node:os";
import path from "node:path";
// Verifica Fase C: statistica, regressione, complessi, somme parziali, sistemi (quaderno)
// + strumenti rapidi della lavagna: area, tangente, tangente animata (+ annulla/ripeti).
import assert from "node:assert/strict";
import { createRequire } from "node:module";
let puppeteer;
try { puppeteer = createRequire(import.meta.url)("puppeteer"); }
catch { const alt = process.env.MATHAPP_PUPPETEER; if (!alt) throw new Error("Puppeteer non installato: esegui npm i -D puppeteer oppure imposta MATHAPP_PUPPETEER."); puppeteer = createRequire(alt)("puppeteer"); }

const CONV = "fasec-check";
const WAIT = (ms) => new Promise((r) => setTimeout(r, ms));

const browser = await puppeteer.launch({ headless: "new", args: ["--no-sandbox", "--disable-gpu"] });
try {
  const page = await browser.newPage();
  await page.setViewport({ width: 1400, height: 900 });
  await page.evaluateOnNewDocument((conv) => {
    localStorage.setItem("mathapp.conv", conv);
    localStorage.setItem("mathapp.empty", "1");
  }, CONV);
  await page.setRequestInterception(true);
  page.on("request", (r) => {
    if (r.url().includes("/api/conversation?id=" + CONV)) { r.respond({ status: 404, contentType: "application/json", body: '{"error":"not found"}' }); return; }
    r.continue();
  });
  await page.goto("http://127.0.0.1:8790/", { waitUntil: "domcontentloaded", timeout: 60000 });
  await page.waitForFunction(() => !!window.__ggb && !booting && !conversationLoading, { timeout: 60000 });
  await page.evaluate(() => window.setMode("algebra"));
  await WAIT(300);

  const submit = (op, expr, order) => page.evaluate((o, e, ord) => {
    if (ord != null) document.querySelector("#calcOrder").value = String(ord);
    document.querySelector("#calcExpr").value = e;
    document.querySelector("#calcOp").value = o;
    document.querySelector("#calcOp").dispatchEvent(new Event("change"));
    document.querySelector("#calcForm").requestSubmit();
  }, op, expr, order ?? null);

  const waitRaw = (frag) => page.waitForFunction(
    (f) => [...document.querySelectorAll("#calcCells .cell")].some((c) => (c.querySelector(".cell-raw") || {}).textContent && c.querySelector(".cell-raw").textContent.includes(f)),
    { timeout: 60000 }, frag);

  const clickDraw = (frag) => page.evaluate((f) => {
    const c = [...document.querySelectorAll("#calcCells .cell")].find((x) => (x.querySelector(".cell-raw") || {}).textContent && x.querySelector(".cell-raw").textContent.includes(f));
    [...c.querySelectorAll(".cell-actions button")].find((b) => b.textContent.includes("Disegna")).click();
  }, frag);

  const names = () => page.evaluate(() => window.__ggb.getAllObjectNames());
  const waitNames = (list) => page.waitForFunction(
    (ls) => { try { const n = window.__ggb.getAllObjectNames(); return ls.every((x) => n.includes(x)); } catch { return false; } },
    { timeout: 30000 }, list);

  // 0) le nuove operazioni sono nel selettore
  let s = await page.evaluate(() => [...document.querySelectorAll("#calcOp option")].map((o) => o.value));
  for (const op of ["stats", "regressione", "complesso", "parziali", "sistema"]) assert.ok(s.includes(op), "opzione presente: " + op);

  // 1) statistica
  await submit("stats", "1, 2, 2, 3, 9");
  await waitRaw("media = 17/5 = 3.4");
  s = await page.evaluate(() => {
    const c = [...document.querySelectorAll("#calcCells .cell")].find((x) => (x.querySelector(".cell-op") || {}).textContent === "statistica");
    return {
      raw: c.querySelector(".cell-raw").textContent,
      labels: [...c.querySelectorAll(".cell-report summary")].map((x) => x.textContent),
      draw: [...c.querySelectorAll(".cell-actions button")].some((b) => b.textContent.includes("Disegna")),
      hint: document.querySelector("#calcHint").textContent,
    };
  });
  assert.match(s.raw, /dev\. standard/, "la statistica riporta la deviazione standard");
  for (const lab of ["Dati", "Media", "Mediana", "Moda", "Dispersione", "Quartili", "Estremi"]) assert.ok(s.labels.includes(lab), "sezione " + lab);
  assert.equal(s.draw, false, "la statistica non ha disegno");
  assert.match(s.hint, /media, mediana/, "suggerimento per la statistica");

  // 2) regressione lineare + disegno (retta e punti)
  await submit("regressione", "1,2; 2,4; 3,5; 4,6");
  await waitRaw("13/10");
  await clickDraw("13/10");
  await waitNames(["f", "P1", "P4"]);
  s = await page.evaluate(() => {
    const norm = (x) => String(window.__ggb.getCommandString(x) || "").replace(/\s+/g, "");
    const tex = (x) => String(window.__ggb.getLaTeXString(x) || "").replace(/[\\\s]/g, "");
    return { f: tex("f"), P1: norm("P1") };
  });
  assert.ok(s.f.includes("13") && s.f.includes("{x}") && s.f.includes("{10}"), "la retta è quella della regressione (" + s.f + ")");
  assert.equal(s.P1, "(1,2)", "i punti dei dati sono sulla lavagna");

  // 3) numeri complessi + piano di Argand
  await submit("complesso", "(3+4i)/(1-2i)");
  await waitRaw("-1 + 2i");
  await clickDraw("-1 + 2i");
  await waitNames(["Z", "zC", "seg1", "seg2"]);
  s = await page.evaluate(() => {
    const norm = (x) => String(window.__ggb.getCommandString(x) || "").replace(/\s+/g, "");
    return {
      Z: norm("Z"), zC: norm("zC"),
      typeSeg: window.__ggb.getObjectType("seg1"),
      lenSeg: window.__ggb.getValue("seg1"),
      raw: [...document.querySelectorAll("#calcCells .cell")].map((c) => (c.querySelector(".cell-raw") || {}).textContent).find((t) => t && t.includes("-1 + 2i")),
      sections: [...document.querySelectorAll("#calcCells .cell")].find((c) => (c.querySelector(".cell-raw") || {}).textContent && c.querySelector(".cell-raw").textContent.includes("-1 + 2i")).querySelector(".cell-report") ? true : false,
    };
  });
  assert.equal(s.Z, "(-1,2)", "il numero è disegnato nel piano di Gauss");
  assert.equal(s.zC, "(-1,-2)", "il coniugato è simmetrico rispetto all'asse reale");
  assert.equal(s.typeSeg, "segment", "il modulo è un segmento dall'origine");
  assert.ok(Math.abs(s.lenSeg - Math.sqrt(5)) < 1e-6, "la lunghezza del segmento è |z| (" + s.lenSeg + ")");
  assert.equal(s.sections, true, "il referto del numero complesso è presente");

  // 4) somme parziali (variabile n impostata da sola)
  s = await page.evaluate(() => {
    document.querySelector("#calcExpr").value = "1/2^n";
    document.querySelector("#calcOp").value = "parziali";
    document.querySelector("#calcOp").dispatchEvent(new Event("change"));
    return { variabile: document.querySelector("#calcVar").value, ordineVisibile: !document.querySelector("#labOrder").hidden };
  });
  assert.equal(s.variabile, "n", "cambiando in «somme parziali» la variabile diventa n");
  assert.equal(s.ordineVisibile, true, "compare il campo «quante»");
  await page.evaluate(() => { document.querySelector("#calcOrder").value = "5"; document.querySelector("#calcForm").requestSubmit(); });
  await waitRaw("S_5 = 31/32");
  await waitRaw("somma della serie = 1");
  await clickDraw("S_5");
  await waitNames(["S1", "S5"]);

  // 5) sistema di equazioni + rette e punto d'intersezione
  await submit("sistema", "x+y=3; x-y=1");
  await waitRaw("x = 2, y = 1");
  await clickDraw("x = 2, y = 1");
  await waitNames(["f", "g", "S"]);
  s = await page.evaluate(() => {
    const norm = (x) => String(window.__ggb.getCommandString(x) || "").replace(/\s+/g, "");
    const tex = (x) => String(window.__ggb.getLaTeXString(x) || "").replace(/[\\\s]/g, "");
    return { S: norm("S"), f: tex("f"), g: tex("g") };
  });
  assert.equal(s.S, "(2,1)", "il punto d'intersezione è segnato");
  assert.ok(s.f.includes("3-x") && s.g.includes("x-1"), "le due rette sono disegnate (" + s.f + " / " + s.g + ")");

  // 6) strumenti lavagna: area fra a e b, con annulla/ripeti
  await page.evaluate(() => window.setMode("figure"));
  await page.waitForFunction(() => { const el = document.querySelector("#ftArea"); return el && el.offsetParent !== null; }, { timeout: 10000 });
  await page.evaluate(() => {
    document.querySelector("#ftFn").value = "x^2-1";
    document.querySelector("#ftA").value = "-1";
    document.querySelector("#ftB").value = "1";
  });
  await page.click("#ftArea");
  await waitNames(["Area"]);
  await page.waitForFunction(() => /area = /.test(document.querySelector("#status").textContent), { timeout: 15000 });
  s = await page.evaluate(() => ({
    val: window.__ggb.getValue("Area"),
    status: document.querySelector("#status").textContent,
    f: String(window.__ggb.getCommandString("f") || "").replace(/\s+/g, ""),
    gVivo: window.__ggb.getAllObjectNames().includes("g"),
  }));
  assert.ok(Math.abs(s.val + 4 / 3) < 1e-6, "area esatta di x²−1 fra −1 e 1 (" + s.val + ")");
  assert.match(s.status, /area = -1\.333/, "il messaggio riporta l'area");
  assert.ok(s.gVivo, "l'area si AGGIUNGE alla costruzione esistente (la retta g resta)");

  await page.click("#undoFig");
  await page.waitForFunction(() => !window.__ggb.getAllObjectNames().includes("Area"), { timeout: 8000 });
  await WAIT(200);
  await page.click("#redoFig");
  await waitNames(["Area"]);

  // 7) tangente in un punto
  await page.evaluate(() => { document.querySelector("#ftX0").value = "0.5"; });
  await page.click("#ftTangent");
  await waitNames(["P0", "tang"]);
  await page.waitForFunction(() => /tangente disegnata/.test(document.querySelector("#status").textContent), { timeout: 15000 });
  s = await page.evaluate(() => ({ x: window.__ggb.getXcoord("P0"), y: window.__ggb.getYcoord("P0") }));
  assert.ok(Math.abs(s.x - 0.5) < 1e-9 && Math.abs(s.y + 0.75) < 1e-9, "il punto di tangenza è sulla curva (" + s.x + "," + s.y + ")");

  // 8) tangente animata: cursore t che scorre davvero
  await page.click("#ftTangentAnim");
  await waitNames(["t", "Pt", "tanA"]);
  s = await page.evaluate(() => window.__ggb.getValue("t"));
  await WAIT(1300);
  const t2 = await page.evaluate(() => window.__ggb.getValue("t"));
  assert.ok(Math.abs(t2 - s) > 1e-9, "il cursore t si muove (animazione attiva): " + s + " -> " + t2);

  console.log("PASS: fase C — statistica, regressione, complessi, parziali, sistemi, area, tangente, tangente animata");
} finally {
  try { await fetch("http://127.0.0.1:8790/api/conversation?id=" + CONV, { method: "DELETE" }); } catch {}
  await browser.close();
}
