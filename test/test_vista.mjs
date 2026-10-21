import os from "node:os";
import path from "node:path";
// Verifica del pannello "Vista": finestra personalizzata, assi, griglia, persistenza.
import assert from "node:assert/strict";
import { createRequire } from "node:module";
let puppeteer;
try { puppeteer = createRequire(import.meta.url)("puppeteer"); }
catch { const alt = process.env.MATHAPP_PUPPETEER; if (!alt) throw new Error("Puppeteer non installato: esegui npm i -D puppeteer oppure imposta MATHAPP_PUPPETEER."); puppeteer = createRequire(alt)("puppeteer"); }

const CONV = "vista-check";
const browser = await puppeteer.launch({ headless: "new", args: ["--no-sandbox", "--disable-gpu"] });
try {
  const page = await browser.newPage();
  await page.setViewport({ width: 1400, height: 900 });
  await page.evaluateOnNewDocument((conv) => {
    localStorage.setItem("mathapp.conv", conv);
    localStorage.setItem("mathapp.empty", "1");
  }, CONV);
  const statePosts = [];
  await page.setRequestInterception(true);
  page.on("request", (r) => {
    if (r.url().includes("/api/conversation/state")) {
      try { statePosts.push(JSON.parse(r.postData() || "{}")); } catch {}
      r.continue();
      return;
    }
    r.continue();
  });
  await page.goto("http://127.0.0.1:8790/", { waitUntil: "domcontentloaded", timeout: 60000 });
  await page.waitForFunction(() => !!window.__ggb, { timeout: 60000 });
  await new Promise((r) => setTimeout(r, 600));

  // il pannello si apre e mostra la finestra corrente
  let s = await page.evaluate(() => {
    document.querySelector("#viewBtn").click();
    const rec = window.viewFromBoard();
    return {
      open: !document.querySelector("#viewPanel").hidden,
      btnOn: document.querySelector("#viewBtn").classList.contains("is-on"),
      xmin: document.querySelector("#vxmin").value,
      hasRec: !!rec,
      rec: rec ? { xmin: Math.round(rec.xmin * 100) / 100, xmax: Math.round(rec.xmax * 100) / 100 } : null,
    };
  });
  assert.equal(s.open, true, "il pannello Vista si apre");
  assert.equal(s.btnOn, true, "il pulsante resta evidenziato");
  assert.notEqual(s.xmin, "", "i campi mostrano la finestra corrente");
  assert.equal(s.hasRec, true, "la finestra si legge dall'XML della lavagna");

  // applica una finestra personalizzata con griglia accesa e assi spenti
  await page.evaluate(() => {
    document.querySelector("#vxmin").value = "2";
    document.querySelector("#vxmax").value = "6";
    document.querySelector("#vymin").value = "-3";
    document.querySelector("#vymax").value = "5";
    document.querySelector("#vaxes").checked = false;
    document.querySelector("#vgrid").checked = true;
    document.querySelector("#viewApply").click();
  });
  await page.waitForFunction(() => {
    const r = window.viewFromBoard();
    return r && Math.abs(r.xmin - 2) < 0.01 && Math.abs(r.xmax - 6) < 0.01 && Math.abs(r.ymin + 3) < 0.01 && Math.abs(r.ymax - 5) < 0.01;
  }, { timeout: 10000 });
  s = await page.evaluate(() => {
    const r = window.viewFromBoard();
    return { axes: r.axes, grid: r.grid };
  });
  assert.equal(s.axes, false, "assi spenti");
  assert.equal(s.grid, true, "griglia accesa");

  // la finestra finisce nello stato salvato
  await new Promise((r) => setTimeout(r, 1500));
  const saved = statePosts.filter((p) => p.view).pop();
  assert.ok(saved, "lo stato salvato include la vista");
  assert.deepEqual(
    { xmin: saved.view.xmin, xmax: saved.view.xmax, ymin: saved.view.ymin, ymax: saved.view.ymax, axes: saved.view.axes, grid: saved.view.grid },
    { xmin: 2, xmax: 6, ymin: -3, ymax: 5, axes: false, grid: true },
    "la vista salvata corrisponde a quella applicata",
  );

  // intervalli non validi: rifiutati con avviso
  await page.evaluate(() => {
    document.querySelector("#vxmin").value = "9";
    document.querySelector("#vxmax").value = "3";
    document.querySelector("#viewApply").click();
  });
  await new Promise((r) => setTimeout(r, 300));
  s = await page.evaluate(() => ({ status: document.querySelector("#status").textContent, rec: window.viewFromBoard() }));
  assert.match(s.status, /controlla gli intervalli/, "intervalli min>max rifiutati con avviso");
  assert.ok(Math.abs(s.rec.xmin - 2) < 0.01, "la finestra resta quella di prima");

  // ricarica: la finestra torna com'era
  await page.reload({ waitUntil: "domcontentloaded", timeout: 60000 });
  await page.waitForFunction(() => !!window.__ggb, { timeout: 60000 });
  await page.waitForFunction(() => {
    const r = window.viewFromBoard();
    return r && r.xmin !== undefined && Math.abs(r.xmin - 2) < 0.02 && Math.abs(r.xmax - 6) < 0.02;
  }, { timeout: 30000 });
  s = await page.evaluate(() => {
    const r = window.viewFromBoard();
    return { xmin: r.xmin, xmax: r.xmax, ymin: r.ymin, ymax: r.ymax };
  });
  // dopo il ricalcolo del layout la finestra può scostarsi di ~1 pixel (0.025 unità): tolleranza 0.05
  assert.ok(Math.abs(s.xmin - 2) < 0.05 && Math.abs(s.xmax - 6) < 0.05 && Math.abs(s.ymin + 3) < 0.05 && Math.abs(s.ymax - 5) < 0.05, "dopo la ricarica la finestra è ripristinata");

  // "Standard" riporta −10…10
  await page.evaluate(() => { document.querySelector("#viewBtn").click(); document.querySelector("#viewStd").click(); });
  await page.waitForFunction(() => {
    const r = window.viewFromBoard();
    return r && Math.abs(r.xmin + 10) < 0.05 && Math.abs(r.xmax - 10) < 0.05;
  }, { timeout: 10000 });

  // "Adatta" senza contenuti: avviso, nessun crash
  s = await page.evaluate(() => {
    document.querySelector("#viewFit").click();
    return document.querySelector("#status").textContent;
  });
  assert.match(s, /niente da inquadrare|inquadrare/, "Adatta con lavagna vuota avvisa senza inquadrare");

  // chiave di chiusura: il pannello si chiude cliccando fuori
  await page.evaluate(() => { document.querySelector("#chatpanel").click(); });
  await new Promise((r) => setTimeout(r, 200));
  s = await page.evaluate(() => document.querySelector("#viewPanel").hidden);
  assert.equal(s, true, "il pannello si chiude cliccando fuori");

  console.log("PASS: pannello Vista (lettura finestra, applica, assi/griglia, persistenza, validazione, Standard, Adatta vuoto, chiusura)");
} finally {
  await browser.close();
  try { await fetch("http://127.0.0.1:8790/api/conversation?id=" + CONV, { method: "DELETE" }); } catch {}
}
