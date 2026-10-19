import os from "node:os";
import path from "node:path";
// Verifica: annulla/ripeti della lavagna (pulsanti + Ctrl+Z), PNG della lavagna.
import assert from "node:assert/strict";
import { createRequire } from "node:module";
let puppeteer;
try { puppeteer = createRequire(import.meta.url)("puppeteer"); }
catch { const alt = process.env.MATHAPP_PUPPETEER; if (!alt) throw new Error("Puppeteer non installato: esegui npm i -D puppeteer oppure imposta MATHAPP_PUPPETEER."); puppeteer = createRequire(alt)("puppeteer"); }

const CONV = "lavagna-check";
const browser = await puppeteer.launch({ headless: "new", args: ["--no-sandbox", "--disable-gpu", "--enable-unsafe-swiftshader"] });
try {
  const page = await browser.newPage();
  await page.setViewport({ width: 1400, height: 900 });
  await page.evaluateOnNewDocument((conv) => {
    localStorage.setItem("mathapp.conv", conv);
    localStorage.setItem("mathapp.empty", "1");
  }, CONV);
  await page.setRequestInterception(true);
  page.on("request", (r) => {
    if (r.url().includes("/api/conversation?id=" + CONV)) { r.respond({ status: 404, contentType: "application/json", body: JSON.stringify({ error: "not found" }) }); return; }
    r.continue();
  });
  await page.goto("http://127.0.0.1:8790/", { waitUntil: "domcontentloaded", timeout: 60000 });
  await page.waitForFunction(() => !!window.__ggb && !booting && !conversationLoading, { timeout: 60000 });
  await new Promise((r) => setTimeout(r, 500));

  // 1) costruzione sulla lavagna (come la scheda "Esegui" di una figura)
  const r1 = await page.evaluate(async () => {
    await window.runFigure({ fid: "t1", title: "Test lavagna", commands: ["A=(1,1)", "B=(3,2)", "s=Segment(A,B)"], view: "2d" }, "replace");
    return { names: window.__ggb.getAllObjectNames().join(",") };
  });
  assert.equal(r1.names, "A,B,s", "la costruzione è sulla lavagna");

  // 2) annulla: sparisce
  await page.click("#undoFig");
  await page.waitForFunction(() => window.__ggb.getAllObjectNames().length === 0, { timeout: 8000 });
  let s = await page.evaluate(() => ({ status: document.querySelector("#status").textContent }));
  assert.match(s.status, /annullato/, "avviso di annullamento");

  // 3) ripeti: torna
  await page.click("#redoFig");
  await page.waitForFunction(() => window.__ggb.getAllObjectNames().join(",") === "A,B,s", { timeout: 8000 });
  s = await page.evaluate(() => ({ status: document.querySelector("#status").textContent }));
  assert.match(s.status, /ripristinato/, "avviso di ripristino");

  // 4) PNG: dati immagine validi + scaricamento dal pulsante
  const png = await page.evaluate(async () => {
    const d = await window.boardPngData();
    return { head: String(d).slice(0, 22), len: String(d).length };
  });
  assert.match(png.head, /^data:image\/png;base64,/, "boardPngData produce un PNG");
  assert.ok(png.len > 2000, "il PNG ha contenuto (" + png.len + " byte)");
  await page.click("#saveFig");
  await new Promise((r) => setTimeout(r, 700));
  s = await page.evaluate(() => ({ status: document.querySelector("#status").textContent }));
  assert.match(s.status, /scaricata/, "avviso di salvataggio PNG");

  // 5) scorciatoia Ctrl+Z fuori dai campi di testo
  await page.evaluate(() => { try { document.activeElement.blur(); } catch {} });
  await page.keyboard.down("Control");
  await page.keyboard.press("z");
  await page.keyboard.up("Control");
  await page.waitForFunction(() => window.__ggb.getAllObjectNames().length === 0, { timeout: 8000 });

  // 6) Ctrl+Z dentro un campo di testo: NON tocca la lavagna (resta vuota, annulla nativo)
  await page.evaluate(async () => { await window.runFigure({ fid: "t2", title: "Test 2", commands: ["C=(0,0)"], view: "2d" }, "replace"); });
  assert.equal(await page.evaluate(() => window.__ggb.getAllObjectNames().length), 1, "seconda costruzione");
  await page.click("#input");
  await page.keyboard.down("Control");
  await page.keyboard.press("z");
  await page.keyboard.up("Control");
  await new Promise((r) => setTimeout(r, 400));
  assert.equal(await page.evaluate(() => window.__ggb.getAllObjectNames().length), 1, "Ctrl+Z nel campo di testo non annulla la lavagna");

  console.log("PASS: lavagna — annulla/ripeti (pulsanti e Ctrl+Z), PNG, rispetto dei campi di testo");
} finally {
  try { await fetch("http://127.0.0.1:8790/api/conversation?id=" + CONV, { method: "DELETE" }); } catch {}
  await browser.close();
}
