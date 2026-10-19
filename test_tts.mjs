import os from "node:os";
import path from "node:path";
// Verifica: lettura ad alta voce (TTS) sulle risposte, con voce del browser simulata.
import assert from "node:assert/strict";
import { createRequire } from "node:module";
let puppeteer;
try { puppeteer = createRequire(import.meta.url)("puppeteer"); }
catch { const alt = process.env.MATHAPP_PUPPETEER; if (!alt) throw new Error("Puppeteer non installato: esegui npm i -D puppeteer oppure imposta MATHAPP_PUPPETEER."); puppeteer = createRequire(alt)("puppeteer"); }

const CONV = "tts-check";
const CONV_JSON = {
  id: CONV, title: "Prova lettura", createdAt: Date.now(), updatedAt: Date.now(), model: "deepseek-v4.1-flash",
  messages: [
    { role: "user", content: "Spiegami la derivata" },
    { role: "assistant", content: "Ecco la **derivata**: la formula $x^2$ ha pendenza.\n\n```\ncodice di prova\n```" },
  ],
  ggb: null, cells: [], figures: [], mode: null,
};

const browser = await puppeteer.launch({ headless: "new", args: ["--no-sandbox", "--disable-gpu"] });
try {
  const page = await browser.newPage();
  await page.setViewport({ width: 1400, height: 900 });
  await page.evaluateOnNewDocument((conv) => {
    localStorage.setItem("mathapp.conv", conv);
    localStorage.removeItem("mathapp.empty");
    // voce del browser finta: registra cosa le viene detto di leggere
    const mock = {
      speak(u) { (window.__spoken = window.__spoken || []).push(String(u && u.text || "")); },
      cancel() { window.__cancels = (window.__cancels || 0) + 1; },
      getVoices() { return [{ lang: "it-IT", name: "Voce finta italiana" }]; },
      pause() {}, resume() {},
    };
    Object.defineProperty(window, "speechSynthesis", { configurable: true, get: () => mock });
  }, CONV);
  await page.setRequestInterception(true);
  page.on("request", (r) => {
    if (r.url().includes("/api/conversation?id=" + CONV)) {
      r.respond({ status: 200, contentType: "application/json", body: JSON.stringify(CONV_JSON) });
      return;
    }
    r.continue();
  });
  await page.goto("http://127.0.0.1:8790/", { waitUntil: "domcontentloaded", timeout: 60000 });
  await page.waitForFunction(() => !!window.__ggb && !booting && !conversationLoading, { timeout: 60000 });
  await page.waitForFunction(() => document.querySelectorAll(".msg.assistant .msg-actions button").length > 0, { timeout: 15000 });

  // 1) pulizia del testo: niente markdown/latex grezzo nella voce
  const clean = await page.evaluate(() => window.ttsClean("Le **derivate** con $x^2$ e $$\\int f$$ e `codice`"));
  assert.ok(!clean.includes("$"), "niente dollari LaTeX: " + clean);
  assert.ok(!clean.includes("*") && !clean.includes("`"), "niente marcatori markdown");
  assert.match(clean, /formula/, "le formule diventano la parola formula");

  // 2) pulsante Ascolta sulla risposta riaperta
  const has = await page.evaluate(() => [...document.querySelectorAll(".msg.assistant .msg-actions button")].some((b) => b.textContent.includes("Ascolta")));
  assert.equal(has, true, "il pulsante Ascolta c'è sulle risposte riaperte");

  await page.evaluate(() => {
    const b = [...document.querySelectorAll(".msg.assistant .msg-actions button")].find((x) => x.textContent.includes("Ascolta"));
    b.click();
  });
  let s = await page.evaluate(() => ({ spoken: window.__spoken || [], spokenBtn: [...document.querySelectorAll(".msg-actions button")].some((b) => b.textContent.includes("Ferma")) }));
  assert.equal(s.spoken.length, 1, "la voce legge una volta");
  assert.match(s.spoken[0], /derivata/, "legge il contenuto della risposta");
  assert.ok(!s.spoken[0].includes("$x^2$"), "la formula non viene letta come LaTeX grezzo");
  assert.equal(s.spokenBtn, true, "il pulsante diventa Ferma durante la lettura");

  // 3) secondo clic: ferma
  await page.evaluate(() => { window.__cancels = 0; });
  await page.evaluate(() => {
    const b = [...document.querySelectorAll(".msg.assistant .msg-actions button")].find((x) => x.textContent.includes("Ferma"));
    b.click();
  });
  s = await page.evaluate(() => ({ cancels: window.__cancels || 0, back: [...document.querySelectorAll(".msg-actions button")].some((b) => b.textContent.includes("Ascolta")) }));
  assert.equal(s.cancels, 1, "il secondo clic ferma la voce");
  assert.equal(s.back, true, "il pulsante torna Ascolta");

  // 4) la lettura si ferma quando si cambia conversazione
  await page.evaluate(() => {
    window.__cancels = 0;
    const b = [...document.querySelectorAll(".msg-actions button")].find((x) => x.textContent.includes("Ascolta"));
    b.click();
  });
  await page.click("#newChat");
  await new Promise((r) => setTimeout(r, 400));
  s = await page.evaluate(() => ({ cancels: window.__cancels || 0 }));
  assert.ok(s.cancels >= 1, "cambiando chat la voce si ferma");

  console.log("PASS: lettura ad alta voce — pulsante sulle risposte, pulizia del testo, stop");
} finally {
  try { await fetch("http://127.0.0.1:8790/api/conversation?id=" + CONV, { method: "DELETE" }); } catch {}
  await browser.close();
}
