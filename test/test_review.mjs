import os from "node:os";
import path from "node:path";
// Test della scheda Ripasso: salvataggio, anteprima espandibile, azioni, dedupe, eliminazione.
import assert from "node:assert/strict";
import { createRequire } from "node:module";
let puppeteer;
try { puppeteer = createRequire(import.meta.url)("puppeteer"); }
catch { const alt = process.env.MATHAPP_PUPPETEER; if (!alt) throw new Error("Puppeteer non installato: esegui npm i -D puppeteer oppure imposta MATHAPP_PUPPETEER."); puppeteer = createRequire(alt)("puppeteer"); }

const B = "http://127.0.0.1:8790";
const QUESTION = "review-probe: quanto fa 2+2?"; // titolo riconoscibile per la pulizia
const ANSWER = "**Grassetto** e $x^2$ esempio.";

// stato iniziale del Ripasso (potrebbero esserci voci reali dell'utente)
const before = await fetch(B + "/api/review").then((r) => r.json());
const n0 = (before.items || []).length;

const browser = await puppeteer.launch({ headless: "new", args: ["--no-sandbox", "--disable-gpu"] });
try {
  const page = await browser.newPage();
  await page.setViewport({ width: 1400, height: 950 });
  page.on("dialog", (d) => d.accept());
  await page.evaluateOnNewDocument(() => {
    localStorage.setItem("mathapp.conv", "review-ui-check");
    localStorage.setItem("mathapp.empty", "1");
  });
  await page.setRequestInterception(true);
  page.on("request", (r) => {
    if (r.url().includes("/api/conversation/state")) { r.abort(); return; }
    if (r.url().endsWith("/api/chat")) {
      r.respond({
        status: 200, headers: { "Content-Type": "text/event-stream; charset=utf-8" },
        body: 'event: delta\ndata: {"text":' + JSON.stringify(ANSWER) + '}\n\nevent: done\ndata: {}\n\n',
      });
      return;
    }
    r.continue();
  });
  await page.goto(B + "/", { waitUntil: "domcontentloaded", timeout: 60000 });
  await page.waitForFunction(() => document.querySelector("#send").textContent === "Invia", { timeout: 30000 });

  // invia un messaggio e salvalo nel Ripasso
  await page.type("#input", QUESTION);
  await page.click("#send");
  await page.waitForFunction(() => document.querySelector("#send").textContent === "Invia", { timeout: 30000 });
  await new Promise((r) => setTimeout(r, 400));
  await page.evaluate(() => {
    const a = [...document.querySelectorAll(".msg.assistant")].pop();
    [...a.querySelectorAll(".msg-actions button")].find((b) => b.textContent.includes("Ripasso")).click();
  });
  await page.waitForFunction(() => {
    const a = [...document.querySelectorAll(".msg.assistant")].pop();
    const b = [...a.querySelectorAll(".msg-actions button")].find((x) => x.textContent.includes("Salvato"));
    return !!b && b.disabled;
  }, { timeout: 15000 });

  // apri la scheda: voce con titolo, data, anteprima e azioni
  await page.click("#reviewBtn");
  await page.waitForFunction((q) => [...document.querySelectorAll("#reviewList .rev-item")].some((r) => r.querySelector(".rev-title").textContent === q), { timeout: 15000 }, QUESTION);
  let s = await page.evaluate((q) => {
    const row = [...document.querySelectorAll("#reviewList .rev-item")].find((r) => r.querySelector(".rev-title").textContent === q);
    return {
      meta: row.querySelector(".rev-meta").textContent,
      text: row.querySelector(".rev-text").textContent,
      formatted: !!row.querySelector(".rev-text strong"),
      actions: [...row.querySelectorAll(".rev-actions button")].map((b) => b.textContent),
      counter: document.querySelector("#reviewCount").textContent,
      open: row.classList.contains("open"),
    };
  }, QUESTION);
  assert.match(s.meta, /\d{2}\/\d{2}\/\d{4}/, "la voce mostra la data");
  assert.match(s.text, /Grassetto/, "la voce mostra l'anteprima della risposta");
  assert.equal(s.formatted, true, "l'anteprima è formattata (markdown)");
  assert.ok(s.actions.includes("Apri sessione") && s.actions.includes("Mostra risposta") && s.actions.includes("Elimina"), "azioni della voce presenti: " + JSON.stringify(s.actions));
  assert.ok(s.actions.some((a) => /Difficile/.test(a)) && s.actions.some((a) => /Media/.test(a)) && s.actions.some((a) => /Facile/.test(a)), "la voce offre anche i giudizi Difficile/Media/Facile");
  assert.ok(s.counter.includes(String(n0 + 1)), "il contatore si aggiorna: " + s.counter);
  assert.equal(s.open, false);

  // anteprima espandibile: "Mostra risposta" toglie il taglio a 3 righe
  await page.evaluate((q) => {
    const row = [...document.querySelectorAll("#reviewList .rev-item")].find((r) => r.querySelector(".rev-title").textContent === q);
    [...row.querySelectorAll(".rev-actions button")].find((b) => b.textContent === "Mostra risposta").click();
  }, QUESTION);
  await new Promise((r) => setTimeout(r, 500));
  s = await page.evaluate((q) => {
    const row = [...document.querySelectorAll("#reviewList .rev-item")].find((r) => r.querySelector(".rev-title").textContent === q);
    const textEl = row.querySelector(".rev-text");
    return {
      open: row.classList.contains("open"),
      clamp: getComputedStyle(textEl).webkitLineClamp,
      toggle: [...row.querySelectorAll(".rev-actions button")].find((b) => /risposta/.test(b.textContent)).textContent,
    };
  }, QUESTION);
  assert.equal(s.open, true, "la voce si espande");
  assert.equal(s.clamp, "none", "senza taglio a 3 righe quando è aperta");
  assert.equal(s.toggle, "Nascondi risposta");

  // niente duplicati: lo stesso salvataggio via API non crea una seconda voce
  const dup1 = await fetch(B + "/api/review", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ convId: "review-ui-check", title: QUESTION, text: ANSWER }) }).then((r) => r.json());
  assert.equal(dup1.existing, true, "il duplicato viene riconosciuto");
  const after = await fetch(B + "/api/review").then((r) => r.json());
  const mine = after.items.filter((i) => i.title === QUESTION);
  assert.equal(mine.length, 1, "una sola voce per lo stesso salvataggio");

  // elimina (con conferma) e verifica il contatore
  await page.evaluate((q) => {
    const row = [...document.querySelectorAll("#reviewList .rev-item")].find((r) => r.querySelector(".rev-title").textContent === q);
    [...row.querySelectorAll(".rev-actions button")].find((b) => b.textContent === "Elimina").click();
  }, QUESTION);
  await page.waitForFunction((q) => ![...document.querySelectorAll("#reviewList .rev-item")].some((r) => r.querySelector(".rev-title").textContent === q), { timeout: 15000 }, QUESTION);
  s = await page.evaluate(() => document.querySelector("#reviewCount").textContent);
  assert.ok(!s.includes(String(n0 + 1)) || n0 + 1 === 0, "il contatore torna al valore precedente: " + s);

  console.log("PASS: scheda Ripasso (salvataggio, anteprima espandibile, azioni, dedupe, eliminazione)", { n0, counter: s });
} finally {
  await browser.close();
  // pulizia: elimina eventuali voci di prova rimaste
  const list = await fetch(B + "/api/review").then((r) => r.json()).catch(() => ({ items: [] }));
  for (const it of (list.items || [])) {
    if (it.title === QUESTION) await fetch(B + "/api/review?id=" + encodeURIComponent(it.id), { method: "DELETE" });
  }
}
