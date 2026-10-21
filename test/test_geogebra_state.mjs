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
    localStorage.setItem("mathapp.conv", "geogebra-api-probe");
    localStorage.setItem("mathapp.empty", "1");
  });
  await page.setRequestInterception(true);
  page.on("request", (request) => {
    if (request.url().includes("/api/conversation/state")) request.abort();
    else request.continue();
  });
  await page.goto("http://127.0.0.1:8790/", { waitUntil: "domcontentloaded", timeout: 60000 });
  await page.waitForFunction(() => !!window.__ggb, { timeout: 60000 });

  const result = await page.evaluate(async () => {
    const api = window.__ggb;
    api.evalCommand("A=(1,2)");
    const immediate = api.getBase64();
    const callbackValue = await new Promise((resolve) => api.getBase64(resolve));
    let setBase64Callback = false;
    const loadCompleted = await new Promise((resolve) => {
      api.setBase64(callbackValue, () => { setBase64Callback = true; resolve(true); });
      setTimeout(() => resolve(false), 15000);
    });
    return {
      immediateType: typeof immediate,
      immediateLength: typeof immediate === "string" ? immediate.length : null,
      callbackType: typeof callbackValue,
      callbackLength: typeof callbackValue === "string" ? callbackValue.length : null,
      setBase64Callback,
      loadCompleted,
      namesAfterLoad: api.getAllObjectNames(),
    };
  });

  assert.equal(result.callbackType, "string", "getBase64(callback) deve restituire la costruzione salvata");
  assert.ok(result.callbackLength > 1000, "il blob GeoGebra callback deve contenere la costruzione");
  assert.equal(result.setBase64Callback, true, "setBase64 deve segnalare il completamento via callback");
  assert.equal(result.loadCompleted, true, "setBase64 deve completare il caricamento entro il timeout del test");
  assert.ok(result.namesAfterLoad.includes("A"), "il callback setBase64 deve scattare dopo aver ripristinato gli oggetti");
  console.log("GeoGebra serialization API:", result);
} finally {
  await browser.close();
}
