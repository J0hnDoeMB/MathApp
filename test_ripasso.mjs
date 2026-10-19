import os from "node:os";
import path from "node:path";
// Verifica: Ripasso con scadenze (SM-2), valutazione difficile/media/facile, export Anki,
// flashcard dagli appunti (instradamento server, senza chiamare il modello).
import assert from "node:assert/strict";
import { createRequire } from "node:module";
let puppeteer;
try { puppeteer = createRequire(import.meta.url)("puppeteer"); }
catch { const alt = process.env.MATHAPP_PUPPETEER; if (!alt) throw new Error("Puppeteer non installato: esegui npm i -D puppeteer oppure imposta MATHAPP_PUPPETEER."); puppeteer = createRequire(alt)("puppeteer"); }

const BASE = "http://127.0.0.1:8790";
const MARK = "ripasso-check";
const WAIT = (ms) => new Promise((r) => setTimeout(r, ms));
const api = async (p, opts) => (await fetch(BASE + p, opts)).json();
const jpost = (p, body) => api(p, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });

let kbDocId = null;
try {
  // 0) preparazione lato server: due voci nuove + deduplica
  const PIT = { convId: MARK, title: "Teorema di Pitagora in un triangolo rettangolo", text: "In un triangolo rettangolo il quadrato dell'ipotenusa è uguale alla somma dei quadrati dei cateti: $c^2 = a^2 + b^2$." };
  const DER = { convId: MARK, title: "Derivata della potenza", text: "La derivata di $x^n$ è $n x^{n-1}$ (regola della potenza)." };
  await jpost("/api/review", PIT);
  const dup = await jpost("/api/review", PIT);
  assert.equal(dup.existing, true, "la stessa voce non si duplica");
  await jpost("/api/review", DER);

  let stato = await api("/api/review");
  let mine = stato.items.filter((r) => r.convId === MARK);
  assert.equal(mine.length, 2, "due voci nel Ripasso");
  for (const r of mine) {
    assert.equal(typeof r.due, "number", "la voce ha una scadenza");
    assert.ok(r.due <= stato.now, "la voce nuova è da ripassare subito");
    assert.equal(r.reps, 0); assert.equal(r.ease, 2.5); assert.equal(r.interval, 0); assert.equal(r.lapses, 0);
  }
  const pitId = mine.find((r) => r.title.includes("Pitagora")).id;

  // 0b) valutazione "media" via API: +1 ripetizione, intervallo 1 giorno
  const med = await jpost("/api/review/grade", { id: pitId, q: "media" });
  assert.equal(med.ok, true);
  assert.equal(med.item.reps, 1);
  assert.equal(med.item.interval, 1);
  assert.ok(Math.abs(med.item.due - (Date.now() + 86400000)) < 60000, "scadenza fra un giorno");
  // riporto Pitagora a "da ripassare" per il test nel browser
  const res0 = await jpost("/api/review/grade", { id: pitId, q: "difficile" });
  assert.equal(res0.item.lapses, 1, "difficile conta un passo falso");
  assert.ok(Math.abs(res0.item.due - (Date.now() + 600000)) < 60000, "difficile rimanda di 10 minuti");

  // 1) badge e pulsanti nel browser
  const browser = await puppeteer.launch({ headless: "new", args: ["--no-sandbox", "--disable-gpu"] });
  try {
    const page = await browser.newPage();
    await page.setViewport({ width: 1400, height: 900 });
    await page.evaluateOnNewDocument((conv) => {
      localStorage.setItem("mathapp.conv", conv);
      localStorage.setItem("mathapp.empty", "1");
    }, MARK);
    await page.setRequestInterception(true);
    page.on("request", (r) => {
      if (r.url().includes("/api/conversation?id=" + MARK)) { r.respond({ status: 404, contentType: "application/json", body: '{"error":"not found"}' }); return; }
      r.continue();
    });
    await page.goto(BASE + "/", { waitUntil: "domcontentloaded", timeout: 60000 });
    await page.waitForFunction(() => !!window.__ggb && !booting && !conversationLoading, { timeout: 60000 });
    await page.waitForFunction(() => !document.querySelector("#reviewBadge").hidden, { timeout: 10000 });

    let s = await page.evaluate(() => ({ badge: document.querySelector("#reviewBadge").textContent }));
    assert.equal(s.badge, "1", "il badge conta solo le voci in scadenza (difficile da 10 min non conta)");

    await page.click("#reviewBtn");
    await page.waitForFunction(() => !document.querySelector("#reviewDrawer").hidden, { timeout: 8000 });
    await page.waitForFunction(() => document.querySelectorAll("#reviewList .rev-item").length === 2, { timeout: 8000 });

    s = await page.evaluate(() => ({
      due: document.querySelectorAll("#reviewList .rev-item.rev-due").length,
      grades: document.querySelectorAll("#reviewList .rev-g").length,
      counter: document.querySelector("#reviewCount").textContent,
      metaPit: [...document.querySelectorAll("#reviewList .rev-item")].find((el) => el.textContent.includes("Pitagora")).querySelector(".rev-meta").textContent,
    }));
    assert.equal(s.due, 1, "una sola voce è in scadenza (l'altra ha la scadenza a 10 minuti)");
    assert.equal(s.grades, 6, "ogni voce ha i tre pulsanti di valutazione");
    assert.match(s.counter, /da ripassare oggi/, "il contatore riassume la giornata");
    assert.match(s.metaPit, /prossimo ripasso/, "Pitagora mostra la prossima scadenza (" + s.metaPit + ")");

    // 2) valuto "facile" la voce in scadenza: intervallo 3 giorni
    await page.evaluate(() => {
      const row = [...document.querySelectorAll("#reviewList .rev-item")].find((el) => el.textContent.includes("Derivata"));
      row.querySelector(".rev-g3").click();
    });
    await page.waitForFunction(() => /prossimo ripasso fra 3 giorni/.test(document.querySelector("#status").textContent), { timeout: 10000 });
    stato = await api("/api/review");
    const der = stato.items.find((r) => r.convId === MARK && r.title.includes("Derivata"));
    assert.equal(der.reps, 1);
    assert.equal(der.interval, 3);
    assert.equal(der.lastGrade, "facile");
    assert.ok(Math.abs(der.due - (Date.now() + 3 * 86400000)) < 60000, "scadenza fra tre giorni");
    await page.waitForFunction(() => document.querySelector("#reviewBadge").hidden, { timeout: 8000 });

    // 3) export Anki: CSV con intestazioni, escaping e a capo HTML
    const csv = await page.evaluate(() => window.buildAnkiCsv([{ title: 'A"B', text: "riga1\nriga2" }, { title: "T", text: "R" }]));
    assert.equal(csv, '#separator:Comma\n#html:true\n"A""B","riga1<br>riga2"\n"T","R"', "CSV Anki ben formato");
    await page.click("#ankiBtn");
    await page.waitForFunction(() => /CSV per Anki scaricato/.test(document.querySelector("#status").textContent), { timeout: 10000 });
    const nSched = (await api("/api/review")).items.length;
    s = await page.evaluate(() => ({ st: document.querySelector("#status").textContent }));
    assert.equal(s.st.includes("(" + nSched + " schede)"), true, "esporta tutte le schede (" + s.st + ")");
    console.log("PASS: ripasso — badge, scadenze, valutazioni, export Anki");
  } finally {
    await browser.close();
  }

  // 4) flashcard dagli appunti: instradamento (dry, senza modello)
  const testo = "La regola del prodotto per le derivate: (f g)' = f' g + f g'. La regola del quoziente: (f/g)' = (f' g - f g')/g^2. La derivata del logaritmo: (ln x)' = 1/x. La derivata dell'esponenziale: (e^x)' = e^x.";
  const doc = await jpost("/api/kb/add", { name: "flashcheck.txt", mime: "text/plain", b64: Buffer.from(testo).toString("base64") });
  assert.equal(doc.ok, true, "appunti caricati");
  kbDocId = doc.doc.id;
  const dry = await jpost("/api/flashcards", { docId: kbDocId, dry: true });
  assert.equal(dry.ok, true, "instradamento flashcard");
  assert.ok(dry.prompt.includes("regola del prodotto"), "il prompt contiene gli estratti");
  assert.ok(dry.prompt.includes('"d"') && dry.prompt.includes('"r"'), "il prompt chiede il formato domanda/risposta");
  const manca = await jpost("/api/flashcards", { docId: "nonesiste" });
  assert.equal(manca.ok, false, "documento inesistente rifiutato");
  console.log("PASS: flashcard — instradamento e prompt dagli appunti");
} finally {
  // pulizia: via le voci di prova e gli appunti di prova
  try {
    const j = await fetch(BASE + "/api/review").then((r) => r.json());
    for (const it of (j.items || []).filter((r) => r.convId === MARK)) {
      await fetch(BASE + "/api/review?id=" + encodeURIComponent(it.id), { method: "DELETE" });
    }
  } catch {}
  if (kbDocId) { try { await fetch(BASE + "/api/kb/doc?id=" + encodeURIComponent(kbDocId), { method: "DELETE" }); } catch {} }
}
