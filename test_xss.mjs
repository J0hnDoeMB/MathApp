import os from "node:os";
import path from "node:path";
import assert from "node:assert/strict";
import { createRequire } from "node:module";

// Riusa Puppeteer già presente nei test locali di MathApp.
let puppeteer;
try { puppeteer = createRequire(import.meta.url)("puppeteer"); }
catch { const alt = process.env.MATHAPP_PUPPETEER; if (!alt) throw new Error("Puppeteer non installato: esegui npm i -D puppeteer oppure imposta MATHAPP_PUPPETEER."); puppeteer = createRequire(alt)("puppeteer"); }

const browser = await puppeteer.launch({
  headless: "new",
  args: ["--no-sandbox", "--disable-gpu"],
});

try {
  const page = await browser.newPage();
  await page.evaluateOnNewDocument(() => {
    localStorage.setItem("mathapp.conv", "xss-regression-probe");
    localStorage.setItem("mathapp.empty", "1");
  });
  await page.setRequestInterception(true);
  page.on("request", (request) => {
    if (request.url().endsWith("/api/chat")) {
      const tool = {
        name: '<img src="/mathapp-xss-tool-missing.png" onerror="window.__mathappToolProbe++">',
        args: { note: '<img src="/mathapp-xss-args-missing.png" onerror="window.__mathappToolProbe++">' },
      };
      const edit = {
        callId: "xss-test",
        ops: [{ op: "not-real", note: "</code><img src=/mathapp-xss-edit-missing.png onerror=window.__mathappToolProbe++><code>" }],
      };
      const body =
        "event: tool\ndata: " + JSON.stringify(tool) + "\n\n" +
        "event: geogebra_edit\ndata: " + JSON.stringify(edit) + "\n\n" +
        'event: delta\ndata: {"text":"Risposta di prova"}\n\n';
      request.respond({
        status: 200,
        headers: { "Content-Type": "text/event-stream; charset=utf-8" },
        body,
      });
    } else if (request.url().includes("/api/conversation/state")) {
      request.abort();
    } else {
      request.continue();
    }
  });
  await page.goto("http://127.0.0.1:8790/", { waitUntil: "domcontentloaded", timeout: 60000 });
  await page.waitForFunction(
    () => !!window.marked && !!window.katex && typeof window.renderMathInElement === "function" && typeof window.renderMD === "function",
    { timeout: 30000 },
  );

  const result = await page.evaluate(async () => {
    window.__mathappXssProbe = 0;
    const host = document.createElement("div");
    document.body.appendChild(host);
    window.renderMD(
      host,
      '<p>testo <strong>sicuro</strong></p>' +
        '<img src="/mathapp-xss-probe-missing.png" onerror="window.__mathappXssProbe++">' +
        '<script>window.__mathappXssProbe += 10</script>' +
        '<a href="javascript:window.__mathappXssProbe++">link</a>',
    );
    await new Promise((resolve) => setTimeout(resolve, 500));
    const state = {
      executed: window.__mathappXssProbe,
      hasImage: !!host.querySelector("img"),
      hasEventHandler: !!host.querySelector("[onerror], [onclick]"),
      hasScript: !!host.querySelector("script"),
      unsafeHref: !!host.querySelector('a[href^="javascript:"]'),
      keepsMarkdown: !!host.querySelector("strong"),
    };
    host.remove();
    return state;
  });

  assert.equal(result.executed, 0, "contenuto Markdown ostile ha eseguito JavaScript");
  assert.equal(result.hasImage, false, "immagini HTML non fidate non devono essere inserite");
  assert.equal(result.hasEventHandler, false, "attributi evento HTML non devono essere inseriti");
  assert.equal(result.hasScript, false, "script HTML non fidati non devono essere inseriti");
  assert.equal(result.unsafeHref, false, "link javascript: non devono essere mantenuti");
  assert.equal(result.keepsMarkdown, true, "la formattazione Markdown legittima deve restare");

  await page.evaluate(() => {
    window.__mathappToolProbe = 0;
    return window.send("prova XSS nei dettagli tool");
  });
  const toolResult = await page.evaluate(() => ({
    executed: window.__mathappToolProbe,
    hasImage: !!document.querySelector(".tools img"),
    hasEventHandler: !!document.querySelector(".tools [onerror], .tools [onclick]"),
  }));
  assert.equal(toolResult.executed, 0, "nome/argomenti di tool non fidati hanno eseguito JavaScript");
  assert.equal(toolResult.hasImage, false, "nome/argomenti di tool non devono diventare HTML");
  assert.equal(toolResult.hasEventHandler, false, "i dettagli tool non devono avere handler HTML");

  const cellResult = await page.evaluate(async () => {
    window.__mathappCellProbe = 0;
    window.addCell("latex", "prova", {
      latex: '<img src="/mathapp-xss-cell-missing.png" onerror="window.__mathappCellProbe++">',
      result: "",
    }, false, false);
    await new Promise((resolve) => setTimeout(resolve, 500));
    return {
      executed: window.__mathappCellProbe,
      hasImage: !!document.querySelector("#calcCells img"),
      hasEventHandler: !!document.querySelector("#calcCells [onerror], #calcCells [onclick]"),
    };
  });
  assert.equal(cellResult.executed, 0, "LaTeX restituito dal calcolo ha eseguito JavaScript");
  assert.equal(cellResult.hasImage, false, "LaTeX non fidato non deve diventare HTML");
  assert.equal(cellResult.hasEventHandler, false, "LaTeX non deve introdurre handler HTML");

  const formulaResult = await page.evaluate(() => {
    window.addCell("factor", "x^2", { result: "x**2", latex: "x^{2}" }, false, false);
    const output = document.querySelector("#calcCells .cell-out");
    const markdown = document.createElement("div");
    window.renderMD(markdown, "$$x^2$$");
    return {
      cellKatex: !!output.querySelector(".katex"),
      markdownKatex: !!markdown.querySelector(".katex"),
      sourceText: output.textContent,
    };
  });
  assert.equal(formulaResult.cellKatex, true, "la formula calcolata deve essere renderizzata con KaTeX");
  assert.equal(formulaResult.markdownKatex, true, "la formula Markdown deve essere renderizzata con KaTeX");
  console.log("PASS: Markdown, dettagli tool e celle neutralizzati; formattazione e formule conservate", result, toolResult, cellResult, formulaResult);
} finally {
  await browser.close();
}
