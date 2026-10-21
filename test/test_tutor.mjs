import os from "node:os";
import path from "node:path";
// Test del selettore "modo tutor": Esercitami / Passo-passo (mutuamente esclusivi, striscia attiva).
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
    localStorage.setItem("mathapp.conv", "tutor-check");
    localStorage.setItem("mathapp.empty", "1");
  });
  const chatBodies = [];
  await page.setRequestInterception(true);
  page.on("request", (r) => {
    if (r.url().includes("/api/conversation/state")) { r.abort(); return; }
    if (r.url().endsWith("/api/chat")) {
      try { chatBodies.push(JSON.parse(r.postData() || "{}")); } catch {}
      r.respond({
        status: 200, headers: { "Content-Type": "text/event-stream; charset=utf-8" },
        body: 'event: delta\ndata: {"text":"Risposta di prova."}\n\nevent: done\ndata: {}\n\n',
      });
      return;
    }
    r.continue();
  });
  await page.goto("http://127.0.0.1:8790/", { waitUntil: "domcontentloaded", timeout: 60000 });
  await page.waitForFunction(() => document.querySelector("#send").textContent === "Invia" && typeof applyTutorMode === "function", { timeout: 30000 });

  // il selettore ha i nomi chiari ed è un gruppo segmentato
  let s = await page.evaluate(() => ({
    group: !!document.querySelector(".tutor-switch.mode-switch"),
    socratic: document.querySelector("#socraticBtn").textContent,
    step: document.querySelector("#stepBtn").textContent,
  }));
  assert.equal(s.group, true, "i due modi stanno in un selettore segmentato");
  assert.equal(s.socratic, "Esercitami");
  assert.equal(s.step, "Passo-passo");

  // accendo Esercitami
  await page.click("#socraticBtn");
  s = await page.evaluate(() => ({
    on: document.querySelector("#socraticBtn").classList.contains("is-active"),
    stepOn: document.querySelector("#stepBtn").classList.contains("is-active"),
    hint: document.querySelector("#modeHint").hidden ? "" : document.querySelector("#modeHint span").textContent,
    ls: localStorage.getItem("mathapp.socratic"),
  }));
  assert.equal(s.on, true, "Esercitami attivo");
  assert.equal(s.stepOn, false);
  assert.match(s.hint, /Esercitami/, "la striscia ricorda il modo attivo");
  assert.equal(s.ls, "1", "la scelta è ricordata");

  // passo a Passo-passo: Esercitami si spegne
  await page.click("#stepBtn");
  s = await page.evaluate(() => ({
    socraticOn: document.querySelector("#socraticBtn").classList.contains("is-active"),
    stepOn: document.querySelector("#stepBtn").classList.contains("is-active"),
    hint: document.querySelector("#modeHint span").textContent,
    lsStep: localStorage.getItem("mathapp.step"),
    lsSoc: localStorage.getItem("mathapp.socratic"),
  }));
  assert.equal(s.socraticOn, false, "i due modi si escludono");
  assert.equal(s.stepOn, true);
  assert.match(s.hint, /Passo-passo/);
  assert.equal(s.lsStep, "1");
  assert.equal(s.lsSoc, "", "la scelta precedente viene rimossa");

  // il modo scelto arriva davvero al server (corpo di /api/chat)
  const sendMsg = async (text) => {
    await page.type("#input", text);
    await page.click("#send");
    await page.waitForFunction(() => document.querySelector("#send").textContent === "Invia", { timeout: 30000 });
  };
  await sendMsg("prova passo-passo");
  assert.equal(chatBodies[chatBodies.length - 1].tutorMode, "step", "col passo-passo il server riceve tutorMode=step");

  // esco con il pulsante della striscia
  await page.click("#modeHintExit");
  s = await page.evaluate(() => ({
    hidden: document.querySelector("#modeHint").hidden,
    anyOn: !!document.querySelector(".tutor-switch .mode-btn.is-active"),
  }));
  assert.equal(s.hidden, true, "la striscia sparisce uscendo");
  assert.equal(s.anyOn, false);

  // modalità normale: tutorMode null
  await sendMsg("prova normale");
  assert.equal(chatBodies[chatBodies.length - 1].tutorMode, null, "senza modo attivo tutorMode è null");

  // Esercitami arriva come socratic
  await page.click("#socraticBtn");
  await sendMsg("prova esercitami");
  assert.equal(chatBodies[chatBodies.length - 1].tutorMode, "socratic", "con Esercitami il server riceve tutorMode=socratic");

  console.log("PASS: modo tutor (Esercitami / Passo-passo, esclusivi, striscia attiva, invio al server)");
} finally {
  await browser.close();
}
