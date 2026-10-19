import os from "node:os";
import path from "node:path";
// Verifica Fase D2: quiz — generazione (mockata), risposte, correzione,
// errori nel Ripasso, modalità a tempo con scadenza automatica.
import assert from "node:assert/strict";
import { createRequire } from "node:module";
let puppeteer;
try { puppeteer = createRequire(import.meta.url)("puppeteer"); }
catch { const alt = process.env.MATHAPP_PUPPETEER; if (!alt) throw new Error("Puppeteer non installato: esegui npm i -D puppeteer oppure imposta MATHAPP_PUPPETEER."); puppeteer = createRequire(alt)("puppeteer"); }

const BASE = "http://127.0.0.1:8790";
const CONV = "quiz-test-ui";
const WAIT = (ms) => new Promise((r) => setTimeout(r, ms));

const QS = [
  { d: "Quanto fa 2+2?", opts: ["3", "4", "5", "6"], ok: 1, why: "aritmetica di base" },
  { d: "Qual e' la derivata di x^2?", opts: ["x", "2x", "x^2", "2"], ok: 1, why: "regola della potenza" },
  { d: "Qual e' la radice quadrata di 16?", opts: ["2", "8", "4", "16"], ok: 2, why: "4^2 = 16" },
];
const TITLES = QS.map((q) => q.d);

const reviewItems = async () => (await (await fetch(BASE + "/api/review")).json()).items.filter((it) => TITLES.includes(String(it.title || "")));

let browser;
try {
  browser = await puppeteer.launch({ headless: "new", args: ["--no-sandbox", "--disable-gpu"] });
  const page = await browser.newPage();
  await page.setViewport({ width: 1400, height: 900 });
  await page.evaluateOnNewDocument((conv) => {
    localStorage.setItem("mathapp.conv", conv);
    localStorage.setItem("mathapp.empty", "1");
  }, CONV);
  await page.setRequestInterception(true);
  page.on("request", (r) => {
    if (r.url().includes("/api/conversation?id=" + CONV)) { r.respond({ status: 404, contentType: "application/json", body: '{"error":"not found"}' }); return; }
    if (r.url().endsWith("/api/quiz")) {
      r.respond({ status: 200, contentType: "application/json", body: JSON.stringify({ ok: true, questions: QS, model: "mock" }) });
      return;
    }
    r.continue();
  });
  await page.goto(BASE + "/", { waitUntil: "domcontentloaded", timeout: 60000 });
  await page.waitForFunction(() => !!window.__ggb && !booting && !conversationLoading, { timeout: 60000 });

  // 0) pulizia di eventuali residui dai run precedenti
  for (const it of await reviewItems()) await fetch(BASE + "/api/review?id=" + encodeURIComponent(it.id), { method: "DELETE" });

  const pick = (qi, oi) => page.evaluate((q, o) => {
    const inp = document.querySelector('input[name="quizq' + q + '"][value="' + o + '"]');
    inp.checked = true;
    inp.dispatchEvent(new Event("change"));
  }, qi, oi);

  // 1) apertura e generazione
  await page.click("#quizBtn");
  await page.waitForFunction(() => !document.querySelector("#quizDrawer").hidden, { timeout: 5000 });
  await page.evaluate(() => {
    document.querySelector("#quizTopic").value = "prova di verifica";
    document.querySelector("#quizN").value = "3";
  });
  await page.click("#quizStart");
  await page.waitForFunction(() => document.querySelectorAll("#quizDrawer .quiz-q").length === 3, { timeout: 15000 });
  let s = await page.evaluate(() => ({
    n: document.querySelectorAll("#quizDrawer .quiz-q").length,
    opts: document.querySelectorAll("#quizDrawer .quiz-opt").length,
    gradeShown: !document.querySelector("#quizGrade").hidden,
    hint: document.querySelector("#quizHint").textContent,
    timerHidden: document.querySelector("#quizTimer").hidden,
  }));
  assert.equal(s.n, 3, "tre domande");
  assert.equal(s.opts, 12, "quattro opzioni per domanda");
  assert.equal(s.gradeShown, true, "compare il pulsante Consegna");
  assert.match(s.hint, /0 di 3/, "conta le risposte date");
  assert.equal(s.timerHidden, true, "senza «a tempo» il cronometro resta nascosto");

  // 2) rispondo: prima giusta, seconda sbagliata, terza in bianco
  await pick(0, 1);
  await pick(1, 3);
  s = await page.evaluate(() => document.querySelector("#quizHint").textContent);
  assert.match(s, /2 di 3/, "il contatore si aggiorna");

  // 3) consegna: punteggio, evidenziazione, spiegazioni
  await page.click("#quizGrade");
  await page.waitForFunction(() => !!document.querySelector("#quizList .quiz-score"), { timeout: 10000 });
  s = await page.evaluate(() => {
    const cards = [...document.querySelectorAll("#quizDrawer .quiz-q")];
    return {
      score: document.querySelector(".quiz-score").textContent,
      q0ok: cards[0].querySelectorAll(".quiz-opt.ok").length,
      q1ok: cards[1].querySelectorAll(".quiz-opt.ok").length,
      q1ko: cards[1].querySelectorAll(".quiz-opt.ko").length,
      fb: cards.map((c) => (c.querySelector(".quiz-fb") || {}).textContent || ""),
      disabled: [...document.querySelectorAll("#quizDrawer .quiz-opt input")].every((i) => i.disabled),
      gradeGone: document.querySelector("#quizGrade").hidden,
      hint: document.querySelector("#quizHint").textContent,
    };
  });
  assert.match(s.score, /punteggio: 1 su 3 \(33%\)/, "punteggio calcolato (" + s.score + ")");
  assert.equal(s.q0ok, 1, "la risposta giusta è evidenziata");
  assert.equal(s.q1ok, 1, "la corretta della domanda sbagliata è evidenziata");
  assert.equal(s.q1ko, 1, "la scelta sbagliata è marcata");
  assert.match(s.fb[0], /giusta/);
  assert.match(s.fb[1], /2x/);
  assert.match(s.fb[1], /regola della potenza/);
  assert.match(s.fb[2], /risposta corretta: 4/);
  assert.equal(s.disabled, true, "le risposte non si cambiano più");
  assert.equal(s.gradeGone, true, "il pulsante di consegna sparisce");
  assert.match(s.hint, /Ripasso/);

  // 4) gli errori sono finiti nel Ripasso (2: sbagliata + in bianco)
  await WAIT(700);
  const inReview = await reviewItems();
  assert.equal(inReview.length, 2, "due errori nel ripasso");
  const t2 = inReview.find((it) => it.title === QS[1].d);
  assert.ok(t2 && /2x/.test(t2.text) && /regola della potenza/.test(t2.text), "scheda di ripasso con risposta corretta e spiegazione");
  assert.equal(inReview.find((it) => it.title === QS[0].d), undefined, "la domanda azzeccata NON finisce nel ripasso");

  // 5) modalità a tempo: scadenza automatica con «tempo scaduto»
  for (const it of await reviewItems()) await fetch(BASE + "/api/review?id=" + encodeURIComponent(it.id), { method: "DELETE" });
  await page.evaluate(() => { document.querySelector("#quizTimed").checked = true; });
  await page.click("#quizStart");
  await page.waitForFunction(() => document.querySelectorAll("#quizDrawer .quiz-q").length === 3, { timeout: 15000 });
  s = await page.evaluate(() => ({
    timerHidden: document.querySelector("#quizTimer").hidden,
    timer: document.querySelector("#quizTimer").textContent,
  }));
  assert.equal(s.timerHidden, false, "il cronometro è visibile");
  assert.match(s.timer, /⏱ 3:00|⏱ 2:59/, "parte da tre minuti (" + s.timer + ")");
  await page.evaluate(() => window.__quiz.forceTimeUp());
  await page.waitForFunction(() => window.__quiz.get().graded === true, { timeout: 5000 });
  s = await page.evaluate(() => ({
    score: document.querySelector(".quiz-score").textContent,
    hint: document.querySelector("#quizHint").textContent,
  }));
  assert.match(s.score, /tempo scaduto/, "il risultato dice che è scaduto il tempo (" + s.score + ")");
  assert.match(s.score, /0 su 3/, "col tempo scaduto e nessuna risposta il punteggio è zero");

  // 6) le tre domande finiscono nel ripasso (nessuna risposta = tre errori)
  await WAIT(700);
  const inReview2 = await reviewItems();
  assert.equal(inReview2.length, 3, "tre errori nel ripasso dopo la scadenza");

  console.log("PASS: quiz — generazione, risposte, correzione con spiegazioni, errori nel Ripasso, tempo scaduto");
} finally {
  try {
    for (const it of await reviewItems()) await fetch(BASE + "/api/review?id=" + encodeURIComponent(it.id), { method: "DELETE" });
  } catch {}
  try { await fetch(BASE + "/api/conversation?id=" + CONV, { method: "DELETE" }); } catch {}
  if (browser) await browser.close();
}
