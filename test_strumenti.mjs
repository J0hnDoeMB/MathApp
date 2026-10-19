import os from "node:os";
import path from "node:path";
// Verifica: scorciatoia "Risolvi l'esercizio" con la foto, PDF del quaderno, backup dei dati.
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import fs from "node:fs";
let puppeteer;
try { puppeteer = createRequire(import.meta.url)("puppeteer"); }
catch { const alt = process.env.MATHAPP_PUPPETEER; if (!alt) throw new Error("Puppeteer non installato: esegui npm i -D puppeteer oppure imposta MATHAPP_PUPPETEER."); puppeteer = createRequire(alt)("puppeteer"); }

const CONV = "strumenti-check";
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

  // 1) foto fra gli allegati: compare la scorciatoia e riempie la richiesta
  await page.evaluate(async () => {
    const f = new File([new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10])], "foto-esercizio.png", { type: "image/png" });
    await window.addFiles([f]);
  });
  let s = await page.evaluate(() => ({
    quick: !!document.querySelector("#photoQuick"),
    label: (document.querySelector("#photoQuick") || {}).textContent,
  }));
  assert.equal(s.quick, true, "con una foto compare la scorciatoia");
  assert.match(s.label, /Risolvi l'esercizio/, "etichetta della scorciatoia");

  await page.click("#photoQuick");
  s = await page.evaluate(() => ({ value: document.querySelector("#input").value }));
  assert.match(s.value, /Risolvi l'esercizio nell'immagine/, "la scorciatoia scrive la richiesta");

  // togliendo la foto la scorciatoia sparisce
  await page.evaluate(() => { document.querySelector(".chip button").click(); });
  await WAIT(200);
  s = await page.evaluate(() => ({ quick: !!document.querySelector("#photoQuick") }));
  assert.equal(s.quick, false, "senza foto la scorciatoia sparisce");

  // 2) PDF del quaderno: finestra con le voci in ordine cronologico
  await page.evaluate(() => {
    window.addCell("factor", "x^2-9", { result: "(x - 3)*(x + 3)", latex: "\\left(x - 3\\right) \\left(x + 3\\right)" }, false);
    window.addCell("solve", "x^2-3x+2=0", { result: "1, 2", latex: "\\left[1, 2\\right]" }, false);
    window.setMode("algebra"); // il quaderno si vede in modalità Algebra
  });
  await WAIT(400);
  const [popup] = await Promise.all([
    new Promise((res) => page.once("popup", res)),
    page.click("#calcPdf"),
  ]);
  assert.ok(popup, "il PDF apre una finestra");
  await popup.waitForFunction(() => document.body && document.body.textContent.includes("Quaderno"), { timeout: 15000 });
  const pdf = await popup.evaluate(() => {
    const t = document.body.textContent || ""; // innerText è vuoto nelle pagine in secondo piano
    return {
      hasTitle: t.includes("Quaderno di algebra"),
      orderOk: t.indexOf("x^2-9") >= 0 && t.indexOf("x^2-9") < t.indexOf("x^2-3x+2=0"),
      opsOk: t.includes("fattorizzazione") && t.includes("soluzione"),
      katex: !!document.querySelector(".katex"),
      detailsOpen: [...document.querySelectorAll("details")].every((d) => d.open),
    };
  });
  assert.equal(pdf.hasTitle, true, "titolo del quaderno");
  assert.equal(pdf.orderOk, true, "le voci sono dal primo all'ultimo");
  assert.equal(pdf.opsOk, true, "le operazioni sono nel foglio");
  assert.equal(pdf.katex, true, "le formule sono rese da KaTeX");
  assert.equal(pdf.detailsOpen, true, "i referti dello studio (se ci sono) restano aperti");
  await popup.close().catch(() => {});

  // 3) backup: pulsante nella Cronologia + info sull'ultimo
  await page.click("#historyBtn");
  await page.waitForFunction(() => !document.querySelector("#historyDrawer").hidden, { timeout: 8000 });
  await page.waitForFunction(() => document.querySelector("#backupInfo").textContent.length > 0, { timeout: 10000 });
  s = await page.evaluate(() => ({ info: document.querySelector("#backupInfo").textContent }));
  assert.match(s.info, /(ultimo:|nessun backup)/, "la riga backup mostra lo stato (" + s.info + ")");

  const before = fs.existsSync("backups") ? fs.readdirSync("backups").filter((f) => f.endsWith(".zip")) : [];
  await page.click("#backupBtn");
  await page.waitForFunction(() => /backup (creato|non riuscito)/.test(document.querySelector("#status").textContent), { timeout: 30000 });
  s = await page.evaluate(() => ({ status: document.querySelector("#status").textContent }));
  assert.match(s.status, /backup creato/, "il backup manuale riesce");
  const after = fs.readdirSync("backups").filter((f) => f.endsWith(".zip"));
  assert.ok(after.length >= 1, "esiste almeno un archivio di backup");
  const newest = after.map((f) => ({ f, t: fs.statSync("backups/" + f).mtimeMs })).sort((a, b) => b.t - a.t)[0];
  assert.ok(fs.statSync("backups/" + newest.f).size > 1000, "l'archivio più recente non è vuoto (" + newest.f + ")");
  assert.ok(after.length <= 7, "i backup vecchi vengono potati (max 7): " + after.length);
  await page.waitForFunction(() => /ultimo:/.test(document.querySelector("#backupInfo").textContent), { timeout: 10000 });

  console.log("PASS: strumenti — foto→esercizio, PDF quaderno (" + before.length + "→" + after.length + " backup), backup manuale");
} finally {
  try { await fetch("http://127.0.0.1:8790/api/conversation?id=" + CONV, { method: "DELETE" }); } catch {}
  await browser.close();
}
