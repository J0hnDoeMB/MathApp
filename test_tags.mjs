import os from "node:os";
import path from "node:path";
// Verifica Fase D: etichette delle conversazioni + ricerca globale nei contenuti.
import assert from "node:assert/strict";
import fs from "node:fs";
import { createRequire } from "node:module";
let puppeteer;
try { puppeteer = createRequire(import.meta.url)("puppeteer"); }
catch { const alt = process.env.MATHAPP_PUPPETEER; if (!alt) throw new Error("Puppeteer non installato: esegui npm i -D puppeteer oppure imposta MATHAPP_PUPPETEER."); puppeteer = createRequire(alt)("puppeteer"); }

const BASE = "http://127.0.0.1:8790";
const CONVDIR = path.join("C:\\Users\\Utente\\Documents\\MathApp", "data", "conversations");
const UI = "tags-test-ui";
const WAIT = (ms) => new Promise((r) => setTimeout(r, ms));

// --- preparazione: due conversazioni di prova scritte direttamente su disco ---
const now = Date.now();
const mk = (id, extra) => Object.assign({
  id, title: "Senza titolo", createdAt: now, updatedAt: now, model: "prova", stateRevision: now, messages: [],
}, extra);
fs.writeFileSync(path.join(CONVDIR, "dtest-1.json"), JSON.stringify(mk("dtest-1", {
  title: "Derivate e pendenza",
  updatedAt: now - 5000,
  messages: [
    { role: "user", content: "come si calcola la derivata di x^3?" },
    { role: "assistant", content: "Si usa la regola del monomio: porta giu' l'esponente. Quindi 3x^2." },
  ],
}), "utf8"));
fs.writeFileSync(path.join(CONVDIR, "dtest-2.json"), JSON.stringify(mk("dtest-2", {
  title: "Studio del cerchio",
  cells: [{ expr: "pi*r^2" }],
  messages: [{ role: "user", content: "area del cerchio rosso" }],
  tags: ["geometria"],
}), "utf8"));

let browser;
try {
  browser = await puppeteer.launch({ headless: "new", args: ["--no-sandbox", "--disable-gpu"] });
  const page = await browser.newPage();
  await page.setViewport({ width: 1400, height: 900 });
  await page.evaluateOnNewDocument((conv) => {
    localStorage.setItem("mathapp.conv", conv);
    localStorage.setItem("mathapp.empty", "1");
  }, UI);
  await page.setRequestInterception(true);
  page.on("request", (r) => {
    if (r.url().includes("/api/conversation?id=" + UI)) { r.respond({ status: 404, contentType: "application/json", body: '{"error":"not found"}' }); return; }
    r.continue();
  });
  await page.goto(BASE + "/", { waitUntil: "domcontentloaded", timeout: 60000 });
  await page.waitForFunction(() => !!window.__ggb && !booting && !conversationLoading, { timeout: 60000 });

  // strumenti del test
  const itemTitles = () => page.evaluate(() =>
    [...document.querySelectorAll("#historyList .hist-item b")].map((b) => b.textContent));
  const search = async (text) => {
    await page.evaluate((t) => {
      const inp = document.querySelector("#historySearch");
      inp.value = t;
      inp.dispatchEvent(new Event("input"));
    }, text);
    await WAIT(500);
    await page.waitForFunction(() => !document.querySelector("#historyList .hist-empty") || document.querySelector("#historySearch").value.trim() === "", { timeout: 5000 }).catch(() => {});
  };
  const rowOf = (title) => `[...document.querySelectorAll("#historyList .hist-item")].find((li) => li.querySelector("b").textContent === ${JSON.stringify(title)})`;
  // attende che la lista CONTENGA le conversazioni volute e NON contenga le altre
  // (la cronologia può avere altre conversazioni che matchano la stessa parola)
  const expectList = async (want, not = []) => {
    await page.waitForFunction((w, n) => {
      const ts = [...document.querySelectorAll("#historyList .hist-item b")].map((b) => b.textContent);
      return w.every((x) => ts.includes(x)) && n.every((x) => !ts.includes(x));
    }, { timeout: 15000 }, want, not);
  };

  // 1) la cronologia elenca le conversazioni di prova, con l'etichetta di dtest-2
  await page.click("#historyBtn");
  await page.waitForFunction(() => document.querySelectorAll("#historyList .hist-item").length >= 2, { timeout: 15000 });
  let s = await page.evaluate((r) => {
    const row = eval(r);
    return { chip: row.querySelector(".hist-tag-name").textContent, nChip: row.querySelectorAll(".hist-tag").length };
  }, rowOf("Studio del cerchio"));
  assert.equal(s.chip, "#geometria", "il chip dell'etichetta è mostrato");
  assert.equal(s.nChip, 1, "una sola etichetta");

  // 2) ricerca per parola nel testo: trova dtest-1 (solo nella domanda) con estratto
  await search("derivata");
  await expectList(["Derivate e pendenza"], ["Studio del cerchio"]);
  s = await page.evaluate((r) => {
    const row = eval(r);
    return {
      title: row.querySelector("b").textContent,
      snip: (row.querySelector(".hist-snip") || {}).textContent || "",
      where: (row.querySelector(".hist-where") || {}).textContent || "",
    };
  }, rowOf("Derivate e pendenza"));
  assert.match(s.snip, /derivata di x\^3/, "l'estratto mostra la frase trovata (" + s.snip + ")");
  assert.match(s.where, /domanda/, "il risultato dice dove è stato trovato");

  // 3) ricerca nella risposta
  await search("monomio");
  await expectList(["Derivate e pendenza"], ["Studio del cerchio"]);
  s = await page.evaluate((r) => {
    const row = eval(r);
    return {
      snip: (row.querySelector(".hist-snip") || {}).textContent || "",
      where: (row.querySelector(".hist-where") || {}).textContent || "",
    };
  }, rowOf("Derivate e pendenza"));
  assert.match(s.snip, /monomio/, "estratto dalla risposta");
  assert.match(s.where, /risposta/);

  // 4) ricerca in un calcolo del quaderno
  await search("pi*r^2");
  await expectList(["Studio del cerchio"], ["Derivate e pendenza"]);
  s = await page.evaluate((r) => {
    const row = eval(r);
    return { where: (row.querySelector(".hist-where") || {}).textContent || "" };
  }, rowOf("Studio del cerchio"));
  assert.match(s.where, /calcolo/, "trovato nei calcoli (" + s.where + ")");

  // 5) filtro per #etichetta (scritto a mano)
  await search("#geometria");
  await expectList(["Studio del cerchio"], ["Derivate e pendenza"]);

  // 6) aggiunta etichetta dalla riga (dtest-1)
  await search("");
  await page.waitForFunction(() => document.querySelectorAll("#historyList .hist-item").length >= 2, { timeout: 15000 });
  await page.evaluate((r) => eval(r).querySelector(".hist-tag-add").click(), rowOf("Derivate e pendenza"));
  await page.waitForFunction((r) => !!eval(r).querySelector(".hist-tag-input"), { timeout: 5000 }, rowOf("Derivate e pendenza"));
  await page.evaluate((r) => {
    const inp = eval(r).querySelector(".hist-tag-input");
    inp.value = "analisi";
    inp.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
  }, rowOf("Derivate e pendenza"));
  await page.waitForFunction((r) => {
    const row = eval(r);
    return [...row.querySelectorAll(".hist-tag-name")].some((c) => c.textContent === "#analisi");
  }, { timeout: 10000 }, rowOf("Derivate e pendenza"));
  let saved = await (await fetch(BASE + "/api/conversation?id=dtest-1")).json();
  assert.deepEqual(saved.tags, ["analisi"], "l'etichetta è salvata nel file della conversazione");

  // 7) rimozione etichetta con la ×
  await page.evaluate((r) => {
    const row = eval(r);
    const chip = [...row.querySelectorAll(".hist-tag")].find((c) => c.querySelector(".hist-tag-name").textContent === "#analisi");
    chip.querySelector(".hist-tag-x").click();
  }, rowOf("Derivate e pendenza"));
  await page.waitForFunction((r) => {
    const row = eval(r);
    return ![...row.querySelectorAll(".hist-tag-name")].some((c) => c.textContent === "#analisi");
  }, { timeout: 10000 }, rowOf("Derivate e pendenza"));
  saved = await (await fetch(BASE + "/api/conversation?id=dtest-1")).json();
  assert.deepEqual(saved.tags, [], "l'etichetta è stata tolta anche dal file");

  // 8) il chip esistente filtra al click
  await page.evaluate((r) => eval(r).querySelector(".hist-tag-name").click(), rowOf("Studio del cerchio"));
  await WAIT(600);
  await expectList(["Studio del cerchio"], ["Derivate e pendenza"]);
  s = await page.evaluate(() => ({
    q: document.querySelector("#historySearch").value,
    titles: [...document.querySelectorAll("#historyList .hist-item b")].map((b) => b.textContent),
  }));
  assert.equal(s.q, "#geometria", "il click sul chip imposta il filtro");
  assert.deepEqual(s.titles, ["Studio del cerchio"], "solo la conversazione con quel tag");

  // 9) regressione: la ricerca per titolo continua a funzionare
  await search("cerchio");
  await expectList(["Studio del cerchio"]);
  s = await page.evaluate((r) => (eval(r).querySelector(".hist-where") || {}).textContent || "", rowOf("Studio del cerchio"));
  assert.match(s, /titolo/, "la ricerca per titolo è ancora riconosciuta");

  console.log("PASS: fase D — etichette delle conversazioni e ricerca globale (titolo, testo, calcoli, #tag)");
} finally {
  try { await fetch(BASE + "/api/conversation?id=" + UI, { method: "DELETE" }); } catch {}
  try { await fetch(BASE + "/api/conversation?id=dtest-1", { method: "DELETE" }); } catch {}
  try { await fetch(BASE + "/api/conversation?id=dtest-2", { method: "DELETE" }); } catch {}
  if (browser) await browser.close();
}
