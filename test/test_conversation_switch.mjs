import os from "node:os";
import path from "node:path";
import assert from "node:assert/strict";
import { createRequire } from "node:module";

let puppeteer;
try { puppeteer = createRequire(import.meta.url)("puppeteer"); }
catch { const alt = process.env.MATHAPP_PUPPETEER; if (!alt) throw new Error("Puppeteer non installato: esegui npm i -D puppeteer oppure imposta MATHAPP_PUPPETEER."); puppeteer = createRequire(alt)("puppeteer"); }
const browser = await puppeteer.launch({ headless: "new", args: ["--no-sandbox", "--disable-gpu"] });

try {
  const page = await browser.newPage();
  await page.evaluateOnNewDocument(() => {
    localStorage.setItem("mathapp.conv", "empty-probe");
    localStorage.setItem("mathapp.empty", "1");
  });

  let firstChatRequest = null;
  let secondChatBody = null;
  let chatCount = 0;
  await page.setRequestInterception(true);
  page.on("request", (request) => {
    const url = new URL(request.url());
    if (url.pathname === "/api/chat") {
      chatCount++;
      if (chatCount === 1) {
        firstChatRequest = request; // resta sospesa per simulare una risposta in streaming
      } else {
        secondChatBody = JSON.parse(request.postData());
        request.respond({
          status: 200,
          headers: { "Content-Type": "text/event-stream; charset=utf-8" },
          body: 'event: delta\ndata: {"text":"risposta nuova"}\n\n',
        });
      }
    } else if (url.pathname === "/api/conversation" && url.searchParams.get("id") === "history-probe") {
      request.respond({
        status: 200,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          id: "history-probe", messages: [
            { role: "user", content: "messaggio storico" },
            { role: "assistant", content: "risposta storica" },
          ],
          cells: [], figures: [], ggb: null, mode: "figure",
        }),
      });
    } else if (url.pathname === "/api/conversation/state") {
      request.respond({ status: 200, headers: { "Content-Type": "application/json" }, body: '{"ok":true}' });
    } else {
      request.continue();
    }
  });

  await page.goto("http://127.0.0.1:8790/", { waitUntil: "domcontentloaded", timeout: 60000 });
  await page.waitForFunction(() => typeof window.send === "function" && typeof window.openConv === "function", { timeout: 30000 });
  await page.evaluate(() => window.__ggbResolve({}));
  await page.evaluate(() => { void window.send("domanda nella chat precedente"); });
  const deadline = Date.now() + 10000;
  while (!firstChatRequest && Date.now() < deadline) await new Promise((resolve) => setTimeout(resolve, 50));
  assert.ok(firstChatRequest, "la prima richiesta chat deve essere partita");

  await page.evaluate(() => window.openConv("history-probe"));
  try {
    await firstChatRequest.respond({
      status: 200,
      headers: { "Content-Type": "text/event-stream; charset=utf-8" },
      body: 'event: delta\ndata: {"text":"risposta tardiva della chat precedente"}\n\n',
    });
  } catch { /* Una correzione può aver annullato la richiesta in modo corretto. */ }
  await page.waitForFunction(() => document.querySelector("#send").textContent === "Invia", { timeout: 10000 });

  await page.evaluate(() => window.send("domanda nella chat storica"));
  await page.waitForFunction(() => !!document.querySelector(".msg.assistant .msg-body")?.textContent.includes("risposta nuova"), { timeout: 10000 });
  assert.ok(secondChatBody, "deve essere partita la richiesta della conversazione aperta");
  assert.equal(
    secondChatBody.messages.some((message) => String(message.content || "").includes("risposta tardiva")),
    false,
    "una risposta tardiva non deve finire nella conversazione appena aperta",
  );
  assert.deepEqual(
    secondChatBody.messages.map((message) => message.content),
    ["messaggio storico", "risposta storica", "domanda nella chat storica"],
  );
  console.log("PASS: uno stream annullato non contamina la conversazione successiva");
} finally {
  await browser.close();
}
