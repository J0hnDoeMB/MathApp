import os from "node:os";
import path from "node:path";
// Test della vista 3D: costruzione 3D dall'IA, esecuzione, badge, interruttore, persistenza.
import assert from "node:assert/strict";
import { createRequire } from "node:module";
let puppeteer;
try { puppeteer = createRequire(import.meta.url)("puppeteer"); }
catch { const alt = process.env.MATHAPP_PUPPETEER; if (!alt) throw new Error("Puppeteer non installato: esegui npm i -D puppeteer oppure imposta MATHAPP_PUPPETEER."); puppeteer = createRequire(alt)("puppeteer"); }

const browser = await puppeteer.launch({ headless: "new", args: ["--no-sandbox", "--enable-unsafe-swiftshader"] });
try {
  const page = await browser.newPage();
  await page.setViewport({ width: 1400, height: 950 });
  await page.evaluateOnNewDocument(() => {
    localStorage.setItem("mathapp.conv", "geogebra-3d-check");
    localStorage.setItem("mathapp.empty", "1");
  });
  const stateBodies = [];
  let servedConversation = null; // usata al reload per simulare un salvataggio
  await page.setRequestInterception(true);
  page.on("request", (r) => {
    if (r.url().includes("/api/conversation/state")) {
      try { stateBodies.push(JSON.parse(r.postData() || "{}")); } catch {}
      r.respond({ status: 200, headers: { "Content-Type": "application/json" }, body: '{"ok":true}' });
      return;
    }
    if (servedConversation && r.url().includes("/api/conversation?id=")) {
      r.respond({ status: 200, headers: { "Content-Type": "application/json" }, body: JSON.stringify(servedConversation) });
      return;
    }
    if (r.url().endsWith("/api/chat")) {
      const callId = "call-3d-1";
      const fig = { callId, fid: "fig-3d-1", title: "sfera e piano", mode: "replace", view: "3d", commands: ["S=Sphere((0,0,0),2)", "P=Plane((0,0,2),(1,0,2),(0,1,2))", "SetColor(S,90,160,255)"] };
      const body =
        "event: tool\ndata: " + JSON.stringify({ name: "geogebra", args: { title: "sfera e piano", view: "3d" } }) + "\n\n" +
        "event: geogebra\ndata: " + JSON.stringify(fig) + "\n\n" +
        'event: delta\ndata: {"text":"Ecco la sfera in 3D."}\n\n' +
        'event: done\ndata: {}\n\n';
      r.respond({ status: 200, headers: { "Content-Type": "text/event-stream; charset=utf-8" }, body });
      return;
    }
    r.continue();
  });

  await page.goto("http://127.0.0.1:8790/", { waitUntil: "domcontentloaded", timeout: 60000 });
  await page.waitForFunction(() => !!window.__ggb && typeof window.setMode === "function", { timeout: 60000 });
  await page.waitForFunction(() => document.querySelector("#send").textContent === "Invia", { timeout: 30000 });
  await new Promise((r) => setTimeout(r, 800));

  // invia un messaggio: l'IA risponde con una costruzione 3D
  await page.type("#input", "Mostrami una sfera in 3D");
  await page.click("#send");
  await page.waitForFunction(() => document.querySelectorAll(".ggb-card").length === 1 && document.querySelector("#send").textContent === "Invia", { timeout: 60000 });
  await new Promise((r) => setTimeout(r, 1500));

  const s = await page.evaluate(() => ({
    objects: window.__ggb.getAllObjectNames().sort(),
    viewOn: document.querySelector("#view3d").classList.contains("is-on"),
    cardTag: (document.querySelector(".ggb-card .fig-3d") || {}).textContent || null,
    option: [...document.querySelectorAll("#figSel option")].map((o) => o.textContent).join(" | "),
    toolLine: [...document.querySelectorAll(".tools")].map((t) => t.textContent).join(" "),
  }));
  assert.ok(s.objects.includes("S"), "la sfera deve esistere nella lavagna: " + s.objects.join(","));
  assert.equal(s.viewOn, true, "la vista 3D deve accendersi da sola");
  assert.equal(s.cardTag, "3D", "la scheda mostra il badge 3D");
  assert.match(s.option, /\[3D\] sfera e piano/, "l'elenco costruzioni segna [3D]");
  assert.match(s.toolLine, /vista 3D/, "la riga dei dettagli menziona la vista 3D");

  // l'interruttore manuale spegne e riaccende la vista
  await page.click("#view3d");
  await new Promise((r) => setTimeout(r, 900));
  let v = await page.evaluate(() => ({ on: document.querySelector("#view3d").classList.contains("is-on"), objs: window.__ggb.getAllObjectNames().length }));
  assert.equal(v.on, false, "l'interruttore spegne la vista 3D");
  assert.equal(v.objs >= 2, true, "gli oggetti restano nella costruzione");
  await page.click("#view3d");
  await new Promise((r) => setTimeout(r, 900));
  v = await page.evaluate(() => document.querySelector("#view3d").classList.contains("is-on"));
  assert.equal(v, true, "l'interruttore riaccende la vista 3D");

  // persistenza: l'ultimo stato salvato contiene view3d e la vista della figura
  await new Promise((r) => setTimeout(r, 1200));
  const last = stateBodies[stateBodies.length - 1];
  assert.ok(last, "deve essere stato salvato uno stato");
  assert.equal(last.view3d, true, "lo stato salva la vista 3D attiva");
  assert.equal((last.figures || [])[0].view, "3d", "la figura salvata ricorda la vista 3D");

  // ---------- stabilità della vista 3D ----------
  const readAngle = () => page.evaluate(() => {
    const m = window.__ggb.getXML().match(/<coordSystem[^>]*xAngle="([^"]+)" zAngle="([^"]+)"/);
    return m ? { x: parseFloat(m[1]), z: parseFloat(m[2]) } : null;
  });
  const setAngle = (x, z) => page.evaluate(([ax, az]) => {
    let xml = window.__ggb.getXML();
    xml = xml.replace(/(<euclidianView3D>[\s\S]*?<coordSystem[^>]*xAngle=")[^"]+(" zAngle=")[^"]+(")/, "$1" + ax + "$2" + az + "$3");
    window.__ggb.setXML(xml);
  }, [x, z]);

  // un assetto "impazzito" viene riportato allo standard dal pulsante ⟲
  // (puntatore sulla lavagna: lo stabilizzatore automatico non interferisce)
  const gbox = await page.evaluate(() => {
    const r = document.querySelector("#ggb").getBoundingClientRect();
    return { cx: r.x + r.width * 0.6, cy: r.y + r.height * 0.5 };
  });
  await page.mouse.move(gbox.cx, gbox.cy);
  await new Promise((r) => setTimeout(r, 300));
  await setAngle(77, 12345);
  await new Promise((r) => setTimeout(r, 700));
  let ang = await readAngle();
  assert.ok(ang && Math.abs(ang.z - 12345) < 2, "assetto di prova impostato: " + JSON.stringify(ang));
  await page.click("#view3dReset");
  await new Promise((r) => setTimeout(r, 900));
  ang = await readAngle();
  assert.ok(ang && Math.abs(ang.x - 20) < 1 && Math.abs(ang.z + 60) < 1, "il pulsante ⟲ riporta la vista allo standard: " + JSON.stringify(ang));

  // stabilizzatore automatico: rotazione senza puntatore sulla lavagna -> torna stabile
  await page.mouse.move(1200, 500); // puntatore fuori dalla lavagna
  await new Promise((r) => setTimeout(r, 2600)); // registra l'assetto stabile
  await setAngle(50, 9999);
  await new Promise((r) => setTimeout(r, 5200));
  ang = await readAngle();
  assert.ok(ang && Math.abs(ang.z) < 360, "lo stabilizzatore riporta la vista a un assetto sano: " + JSON.stringify(ang));

  // normalizzazione al ripristino: un salvataggio con angolo "impazzito" torna standard al reload
  await setAngle(30, 15000);
  await new Promise((r) => setTimeout(r, 700));
  await page.evaluate(() => window.saveState());
  await new Promise((r) => setTimeout(r, 1000));
  const crazy = stateBodies[stateBodies.length - 1];
  assert.ok(crazy && crazy.ggb, "salvataggio con la lavagna presente");
  servedConversation = { id: "geogebra-3d-check", messages: [], cells: [], figures: [], mode: "figure", ggb: crazy.ggb, view3d: true, stateRevision: crazy.revision };
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.waitForFunction(() => !!window.__ggb, { timeout: 60000 });
  await new Promise((r) => setTimeout(r, 2500));
  ang = await readAngle();
  assert.ok(ang && Math.abs(ang.x - 20) < 1 && Math.abs(ang.z + 60) < 1, "al ripristino l'orientamento impazzito torna standard: " + JSON.stringify(ang));

  await page.screenshot({ path: path.join(os.tmpdir(), "ggb3d-check.png") });
  console.log("PASS: vista 3D (costruzione IA, auto-switch, badge, interruttore, persistenza, stabilità)", JSON.stringify(s));
} finally {
  await browser.close();
}
