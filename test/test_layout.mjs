import os from "node:os";
import path from "node:path";
// Test: trascinando il divisore, la figura cresce e l'applet GeoGebra si adatta.
import assert from "node:assert/strict";
import { createRequire } from "node:module";
let puppeteer;
try { puppeteer = createRequire(import.meta.url)("puppeteer"); }
catch { const alt = process.env.MATHAPP_PUPPETEER; if (!alt) throw new Error("Puppeteer non installato: esegui npm i -D puppeteer oppure imposta MATHAPP_PUPPETEER."); puppeteer = createRequire(alt)("puppeteer"); }

const browser = await puppeteer.launch({ headless: "new", args: ["--no-sandbox", "--disable-gpu"] });
try {
  const page = await browser.newPage();
  await page.setViewport({ width: 1400, height: 950 });
  await page.evaluateOnNewDocument(() => {
    localStorage.setItem("mathapp.conv", "layout-check");
    localStorage.setItem("mathapp.empty", "1");
  });
  await page.setRequestInterception(true);
  page.on("request", (r) => { if (r.url().includes("/api/conversation/state")) r.abort(); else r.continue(); });
  await page.goto("http://127.0.0.1:8790/", { waitUntil: "domcontentloaded", timeout: 60000 });
  await page.waitForFunction(() => !!window.__ggb, { timeout: 60000 });
  await new Promise((r) => setTimeout(r, 1500));

  const measure = () => page.evaluate(() => ({
    wrap: Math.round(document.querySelector("#ggbwrap").getBoundingClientRect().width),
    host: Math.round(document.querySelector("#ggb").getBoundingClientRect().width),
    chat: Math.round(document.querySelector("#chatpanel").getBoundingClientRect().width),
  }));
  const before = await measure();

  // rimpicciolisci la chat: la figura deve crescere E l'applet adattarsi
  const d = await page.evaluate(() => { const r = document.querySelector("#divider").getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; });
  await page.mouse.move(d.x, d.y);
  await page.mouse.down();
  await page.mouse.move(d.x + 300, d.y, { steps: 12 });
  await page.mouse.up();
  await new Promise((r) => setTimeout(r, 1200));
  const after = await measure();

  assert.ok(after.chat < before.chat - 200, `la chat si rimpicciolisce: ${before.chat} -> ${after.chat}`);
  assert.ok(after.wrap > before.wrap + 200, `il pannello figura cresce: ${before.wrap} -> ${after.wrap}`);
  assert.ok(after.host >= after.wrap - 4, `l'applet riempie il pannello: host ${after.host} vs pannello ${after.wrap}`);

  // e al contrario: allargando la chat, la figura si rimpicciolisce e l'applet segue
  const d2 = await page.evaluate(() => { const r = document.querySelector("#divider").getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; });
  await page.mouse.move(d2.x, d2.y);
  await page.mouse.down();
  await page.mouse.move(d2.x - 420, d2.y, { steps: 14 });
  await page.mouse.up();
  await new Promise((r) => setTimeout(r, 1200));
  const back = await measure();
  assert.ok(back.wrap < after.wrap - 200, `riallargando la chat la figura torna piccola: ${after.wrap} -> ${back.wrap}`);
  assert.ok(back.host >= back.wrap - 4, `l'applet segue anche in riduzione: host ${back.host} vs pannello ${back.wrap}`);

  await page.screenshot({ path: path.join(os.tmpdir(), "layout-check.png") });
  console.log("PASS: divisore (chat piccola -> figura grande -> applet adattata)", { before, after, back });
} finally {
  await browser.close();
}
