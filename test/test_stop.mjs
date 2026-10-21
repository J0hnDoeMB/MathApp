import os from "node:os";
import path from "node:path";
// Verifica: mentre l'IA risponde il pulsante "Invia" diventa "Ferma" e un clic interrompe la risposta.
import assert from "node:assert/strict";
import { createRequire } from "node:module";
let puppeteer;
try { puppeteer = createRequire(import.meta.url)("puppeteer"); }
catch { const alt = process.env.MATHAPP_PUPPETEER; if (!alt) throw new Error("Puppeteer non installato: esegui npm i -D puppeteer oppure imposta MATHAPP_PUPPETEER."); puppeteer = createRequire(alt)("puppeteer"); }

const browser = await puppeteer.launch({ headless: "new", args: ["--no-sandbox", "--disable-gpu"] });
try {
  const page = await browser.newPage();
  await page.evaluateOnNewDocument(() => {
    localStorage.setItem("mathapp.conv", "stop-probe");
    localStorage.setItem("mathapp.empty", "1");
  });

  let chatCount = 0;
  let aborted = false;
  await page.setRequestInterception(true);
  page.on("request", (request) => {
    const url = new URL(request.url());
    if (url.pathname === "/api/chat") {
      chatCount++;
      if (chatCount === 1) return; // resta sospesa: simula una risposta lunga in corso
      request.respond({
        status: 200,
        headers: { "Content-Type": "text/event-stream; charset=utf-8" },
        body: 'event: delta\ndata: {"text":"risposta dopo lo stop"}\n\n',
      });
      return;
    }
    if (url.pathname === "/api/conversation/state") {
      request.respond({ status: 200, headers: { "Content-Type": "application/json" }, body: '{"ok":true}' });
      return;
    }
    request.continue();
  });
  page.on("requestfailed", (request) => {
    try { if (new URL(request.url()).pathname === "/api/chat") aborted = true; } catch { /* ignora */ }
  });

  await page.goto("http://127.0.0.1:8790/", { waitUntil: "domcontentloaded", timeout: 60000 });
  await page.waitForFunction(() => typeof window.send === "function", { timeout: 30000 });
  await page.evaluate(() => window.__ggbResolve({}));

  // invia: mentre l'IA "parla" il pulsante si trasforma in Ferma
  await page.type("#input", "domanda lunga");
  await page.click("#send");
  await page.waitForFunction(() => document.querySelector("#send").textContent === "Ferma", { timeout: 8000 });
  let s = await page.evaluate(() => ({
    cls: document.querySelector("#send").classList.contains("is-stop"),
    title: document.querySelector("#send").title,
    status: document.querySelector("#status").textContent,
    disabled: document.querySelector("#send").disabled,
  }));
  assert.equal(s.cls, true, "il pulsante prende lo stile da stop");
  assert.match(s.title, /Interrompi/, "il titolo spiega che il clic interrompe");
  assert.match(s.status, /pensando/, "lo stato dice che sta pensando");
  assert.equal(s.disabled, false, "il pulsante resta cliccabile mentre l'IA risponde");

  // clic sul pulsante trasformato: interrompe, non invia
  await page.click("#send");
  await page.waitForFunction(() => document.querySelector("#send").textContent === "Invia", { timeout: 8000 });
  const deadline = Date.now() + 8000;
  while (!aborted && Date.now() < deadline) await new Promise((r) => setTimeout(r, 100));
  assert.ok(aborted, "il clic ha annullato la richiesta in corso");
  s = await page.evaluate(() => ({
    cls: document.querySelector("#send").classList.contains("is-stop"),
    users: document.querySelectorAll(".msg.user").length,
    body: [...document.querySelectorAll(".msg.assistant .msg-body")].map((el) => el.textContent).join("\n"),
  }));
  assert.equal(s.cls, false, "finito lo stop il pulsante torna Invia");
  assert.equal(s.users, 1, "il clic di stop non ha inviato un nuovo messaggio");
  assert.match(s.body, /interrotto/, "la risposta interrotta lo segnala nel testo");

  // la chat non resta bloccata: si può inviare di nuovo
  await page.type("#input", "seconda domanda");
  await page.click("#send");
  await page.waitForFunction(() => document.body.textContent.includes("risposta dopo lo stop"), { timeout: 10000 });
  console.log("PASS: il pulsante Invia diventa Ferma e interrompe la risposta (poi si riparte)");
} finally {
  await browser.close();
}
