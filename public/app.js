// MathApp front-end: chat con streaming + KaTeX + GeoGebra pilotato dall'IA.
const $ = (s) => document.querySelector(s);
const chatEl = $("#chat"), inputEl = $("#input"), sendBtn = $("#send");
const statusEl = $("#status"), modelEl = $("#model"), mainEl = $("#main");

let messages = [];
const storedConv = (() => { try { return localStorage.getItem("mathapp.conv"); } catch { return null; } })();
let conversationId = storedConv || crypto.randomUUID();
let sessionId = conversationId;
let conversationGeneration = 0;
let conversationLoading = false;
let stateRevision = (() => { try { return Number(localStorage.getItem("mathapp.stateRevision")) || 0; } catch { return 0; } })();
let cellData = [];
let booting = true;
let mode = "figure";
let tutorMode = null;      // "socratic" | null
let stepMode = false;      // rivelazione passo-passo
let currentAbort = null;
let pendingSources = null;
let usageTot = { prompt: 0, completion: 0, total: 0 };
let currentModel = "deepseek-v4.1-flash";
let ggbApplet = null;
let ggbReady = false;
const ggbReadyPromise = new Promise((r) => { window.__ggbResolve = r; });
let ggbWorkQueue = Promise.resolve();

function enqueueGgbWork(expectedGeneration, work) {
  const task = ggbWorkQueue.catch(() => {}).then(async () => {
    await ggbReadyPromise;
    if (expectedGeneration !== conversationGeneration) return false;
    return await work();
  });
  ggbWorkQueue = task.catch((e) => { console.warn("[MathApp] operazione GeoGebra fallita", e); return false; });
  return task;
}

function queueGgbClear(expectedGeneration = conversationGeneration) {
  return enqueueGgbWork(expectedGeneration, () => {
    if (expectedGeneration !== conversationGeneration) return false;
    try { ggbApplet.newConstruction(); applyGgbTheme(); return true; }
    catch (e) { console.warn("[MathApp] pulizia GeoGebra fallita", e); return false; }
  });
}

function setGgbBase64Async(data) {
  return new Promise((resolve) => {
    let settled = false;
    const finish = (ok) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(ok);
    };
    const timer = setTimeout(() => {
      console.warn("[MathApp] timeout nel ripristino dello stato GeoGebra");
      finish(false);
    }, 20000);
    try {
      const result = ggbApplet.setBase64(data, () => finish(true));
      if (result && typeof result.then === "function") result.then(() => finish(true), () => finish(false));
    } catch (e) {
      console.warn("[MathApp] stato GeoGebra non leggibile", e);
      finish(false);
    }
  });
}

// ---------- GeoGebra ----------
function initGGB() {
  const host = $("#ggb");
  const wrapEl = $("#ggbwrap");
  const w = Math.max(400, host.clientWidth || 900), h = Math.max(400, host.clientHeight || 600);
  const params = {
    appName: "classic", width: w, height: h, showToolBar: true, showAlgebraInput: true,
    showMenuBar: false, showKeyboardOnFocus: false, preventFocus: true, errorDialogsActive: false,
    enableRightClick: true, language: "it",
    appletOnLoad: (api) => { ggbApplet = api; ggbReady = true; window.__ggb = api; window.__ggbResolve(api); setTimeout(() => { try { applyGgbTheme(); } catch {} }, 400); setTimeout(() => ggbResize(), 60); },
  };
  const app = new GGBApplet(params, true);
  app.inject("ggb");
  // ridimensiona l'applet quando cambia lo spazio disponibile (finestra o divider)
  try { new ResizeObserver(() => ggbResize()).observe(wrapEl); } catch {}
  window.addEventListener("resize", () => ggbResize());
}

// deployggb fissa width/height inline sul contenitore #ggb (e il CSS non lo stira):
// aggiorniamo quella dimensione e ridimensioniamo l'applet con setSize, così la
// lavagna riempie il pannello quando si trascina il divisore o cambia la finestra.
let ggbResizeQueued = false, ggbLastW = 0, ggbLastH = 0;
function ggbResize() {
  if (!ggbReady || ggbResizeQueued) return;
  ggbResizeQueued = true;
  requestAnimationFrame(() => {
    ggbResizeQueued = false;
    if (!ggbReady) return;
    try {
      const host = $("#ggb"), wrapEl = $("#ggbwrap");
      const tools = document.getElementById("figTools");
      const th = tools && tools.offsetParent ? tools.offsetHeight + 2 : 0; // barra strumenti sotto la lavagna
      const ww = Math.round(wrapEl.clientWidth - 2);
      const hh = Math.round(wrapEl.clientHeight - host.offsetTop - th - 2);
      if (ww < 50 || hh < 50) return;
      if (ww === ggbLastW && hh === ggbLastH) return;
      ggbLastW = ww; ggbLastH = hh;
      host.style.width = ww + "px";
      host.style.height = hh + "px";
      if (ggbApplet.setSize) ggbApplet.setSize(ww, hh);
    } catch {}
  });
}

// I comandi di STILE non funzionano via evalCommand: vanno tradotti in chiamate API.
function ggbStyleCall(cmd) {
  const m = String(cmd).match(/^\s*(SetColor|SetVisible|SetLabelVisible|SetLineThickness|SetLineStyle|SetPointSize|SetFilling|SetCaption)\s*\(([\s\S]*)\)\s*$/);
  if (!m) return null;
  const fn = m[1], raw = m[2];
  const args = raw.split(",").map((s) => s.trim());
  const obj = args[0];
  const n = (i) => Number(args[i]);
  const boolOf = (v) => /true|1/i.test(String(v));
  const rest = () => raw.slice(raw.indexOf(",") + 1).trim().replace(/^"([\s\S]*)"$/, "$1");
  switch (fn) {
    case "SetColor": return () => ggbApplet.setColor(obj, n(1) | 0, n(2) | 0, n(3) | 0);
    case "SetVisible": return () => ggbApplet.setVisible(obj, boolOf(args[1]));
    case "SetLabelVisible": return () => ggbApplet.setLabelVisible(obj, boolOf(args[1]));
    case "SetLineThickness": return () => ggbApplet.setLineThickness(obj, n(1));
    case "SetLineStyle": return () => ggbApplet.setLineStyle(obj, n(1));
    case "SetPointSize": return () => ggbApplet.setPointSize(obj, n(1));
    case "SetFilling": return () => ggbApplet.setFilling(obj, n(1));
    case "SetCaption": return () => ggbApplet.setCaption(obj, rest());
    default: return null;
  }
}

async function applyCommands(commands, expectedGeneration = conversationGeneration) {
  await ggbReadyPromise;
  if (expectedGeneration !== conversationGeneration) return [];
  const results = [];
  for (const c of (Array.isArray(commands) ? commands : [])) {
    const styleCall = ggbStyleCall(c);
    if (styleCall) {
      try { styleCall(); results.push({ command: c, ok: true, via: "api" }); }
      catch (e) { results.push({ command: c, ok: false, error: String(e) }); }
      continue;
    }
    try {
      const ok = ggbApplet.evalCommand(String(c));
      results.push({ command: c, ok: !!ok });
    } catch (e) { results.push({ command: c, ok: false, error: String(e) }); }
  }
  return results;
}

// ---------- annulla/ripeti e immagine della lavagna ----------
// GeoGebra annulla/ripete navigando SOLO fra gli "undo point" espliciti: ne
// piazziamo uno PRIMA e uno DOPO ogni modifica della lavagna (costruzione,
// aggiunta, modifica dell'IA), così ↶ torna indietro e ↷ riporta avanti.
function pushUndoPoint() {
  try { if (ggbReady && ggbApplet.setUndoPoint) ggbApplet.setUndoPoint(); } catch {}
}

function boardUndo() {
  if (!ggbReady) return;
  try { ggbApplet.undo(); flash("lavagna: annullato"); } catch {}
}

function boardRedo() {
  if (!ggbReady) return;
  try { ggbApplet.redo(); flash("lavagna: ripristinato"); } catch {}
}

// PNG della lavagna: getScreenshotBase64 quando c'è, altrimenti il canvas grande.
function boardPngData() {
  return new Promise((resolve) => {
    const fallback = () => {
      try {
        const c = [...document.querySelectorAll("#ggb canvas")].sort((a, b) => b.width * b.height - a.width * a.height)[0];
        resolve(c ? c.toDataURL("image/png") : "");
      } catch { resolve(""); }
    };
    if (!ggbReady) return resolve("");
    let done = false;
    const finish = (v) => { if (!done) { done = true; resolve(v || ""); } };
    try {
      if (typeof ggbApplet.getScreenshotBase64 === "function") {
        ggbApplet.getScreenshotBase64((b64) => finish(b64 ? "data:image/png;base64," + b64 : ""));
        setTimeout(() => { if (!done) fallback(); }, 1500);
      } else fallback();
    } catch { fallback(); }
  });
}
window.boardPngData = boardPngData; // usato dai collaudi

function postGgbResult(callId, results) {
  return fetch("/api/geogebra-result", {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ callId, results }),
  }).catch(() => {});
}



// ---------- costruzioni GeoGebra: salvate e riproducibili ----------
let figures = [];
let figSeq = 0;

const escapeHtml = (s) => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

function refreshFigureList() {
  const sel = $("#figSel");
  if (!sel) return;
  if (!figures.length) { sel.disabled = true; sel.innerHTML = '<option value="">nessuna costruzione</option>'; return; }
  sel.disabled = false;
  sel.innerHTML = '<option value="">Costruzioni (' + figures.length + ')</option>' +
    figures.map((f, i) => '<option value="' + escapeHtml(f.fid) + '">' + (i + 1) + ". " + (f.view === "3d" ? "[3D] " : "") + escapeHtml(f.title || "figura") + "</option>").join("");
}

async function runFigure(fig, mode, expectedGeneration = conversationGeneration) {
  await ggbReadyPromise;
  if (expectedGeneration !== conversationGeneration || conversationLoading) return { okN: 0, total: (fig.commands || []).length };
  setView3d(fig.view === "3d", expectedGeneration); // la figura vive nella sua vista
  if (mode === "replace") { try { ggbApplet.newConstruction(); applyGgbTheme(); } catch {} }
  pushUndoPoint(); // annulla = toglie questa costruzione dalla lavagna
  const res = await applyCommands(fig.commands, expectedGeneration);
  pushUndoPoint(); // …e ripeti = la rimette
  if (expectedGeneration !== conversationGeneration) return { okN: 0, total: (fig.commands || []).length };
  const okN = res.filter((r) => r.ok).length;
  refreshFigureList();
  if (expectedGeneration === conversationGeneration) saveState();
  return { okN, total: res.length };
}

// apre i dettagli del messaggio che contiene la scheda (usato quando qualcosa fallisce)
function openDetailsNear(card) {
  const msg = card.closest(".msg");
  const box = msg ? msg.querySelector(".tools-details") : null;
  if (box) { box.open = true; box.classList.add("has-error"); }
}

// Tema scuro anche per la lavagna GeoGebra: si cambiano i colori delle viste nell'XML.
function applyGgbTheme() {
  if (!ggbReady) return;
  try {
    const dark = document.body.classList.contains("theme-dark");
    let xml = ggbApplet.getXML();
    const bg = dark ? 'r="17" g="24" b="33"' : 'r="255" g="255" b="255"';
    const ax = dark ? 'r="150" g="166" b="182"' : 'r="28" g="28" b="31"';
    const gr = dark ? 'r="44" g="56" b="70"' : 'r="180" g="179" b="186"';
    const recolor = (block, tag, attrs) => block.replace(new RegExp("<" + tag + "[^>]*/>"), "<" + tag + " " + attrs + "/>");
    // vista 2D
    xml = xml.replace(/<euclidianView>[\s\S]*?<\/euclidianView>/, (block) =>
      recolor(recolor(recolor(block, "bgColor", bg), "axesColor", ax), "gridColor", gr));
    // vista 3D (sfondo)
    xml = xml.replace(/<euclidianView3D>[\s\S]*?<\/euclidianView3D>/, (block) => recolor(block, "bgColor", bg));
    ggbApplet.setXML(xml);
  } catch (e) { console.warn("[MathApp] tema GeoGebra non applicato", e); }
}

// ---------- vista 2D / 3D della lavagna ----------
let ggb3d = false;
const VIEW3D_STD = { x: 20, z: -60 }; // orientamento standard della vista 3D

// Riscrive l'orientamento della vista 3D nell'XML (gli oggetti restano).
function setView3dAngles(angles) {
  if (!ggbReady) return false;
  try {
    const xml = ggbApplet.getXML();
    const fixed = xml.replace(
      /(<euclidianView3D>[\s\S]*?<coordSystem[^>]*xAngle=")[^"]+(" zAngle=")[^"]+(")/,
      "$1" + angles.x + "$2" + angles.z + "$3",
    );
    if (fixed === xml) return false;
    ggbApplet.setXML(fixed);
    return true;
  } catch (e) { console.warn("[MathApp] orientamento 3D non reimpostato", e); return false; }
}

function resetView3d() {
  if (!ggb3d) return;
  if (setView3dAngles(VIEW3D_STD)) flash("vista 3D riportata allo standard");
}
$("#view3dReset").addEventListener("click", resetView3d);

// Stabilizzatore: se l'orientamento 3D cambia senza che il puntatore sia sulla lavagna
// (trascinamento rimasto "appeso", sessioni remote…), torna all'ultimo assetto stabile.
let ggbPointerOver = false, view3dWatchLast = null, view3dWatchStable = null, view3dWatchResetAt = 0;
(() => {
  const host = $("#ggb");
  if (!host) return;
  host.addEventListener("pointerenter", () => { ggbPointerOver = true; });
  host.addEventListener("pointerleave", () => { ggbPointerOver = false; });
  setInterval(() => {
    if (!ggbReady || !ggb3d) return;
    let ang = null;
    try {
      const m = ggbApplet.getXML().match(/<coordSystem[^>]*xAngle="([^"]+)" zAngle="([^"]+)"/);
      if (m) ang = { x: parseFloat(m[1]), z: parseFloat(m[2]) };
    } catch {}
    if (!ang || !Number.isFinite(ang.x) || !Number.isFinite(ang.z)) return;
    const changed = view3dWatchLast && (Math.abs(ang.z - view3dWatchLast.z) > 1.5 || Math.abs(ang.x - view3dWatchLast.x) > 1.5);
    if (changed && !ggbPointerOver && Date.now() - view3dWatchResetAt > 8000) {
      view3dWatchResetAt = Date.now();
      const target = view3dWatchStable || VIEW3D_STD;
      if (setView3dAngles(target)) console.info("[MathApp] vista 3D riportata all'assetto stabile", target);
      ang = target;
    } else if (!changed && !ggbPointerOver) {
      view3dWatchStable = ang;
    }
    view3dWatchLast = ang;
  }, 2000);
})();

function updateViewButton() {
  const b = $("#view3d");
  if (b) {
    b.classList.toggle("is-on", ggb3d);
    b.setAttribute("aria-pressed", String(ggb3d));
    b.title = ggb3d ? "Torna alla vista 2D" : "Mostra la vista 3D (solidi, superfici, funzioni di due variabili)";
  }
  const r = $("#view3dReset");
  if (r) r.hidden = !ggb3d;
}
function setView3d(on, expectedGeneration = conversationGeneration) {
  on = !!on;
  if (expectedGeneration !== conversationGeneration) return;
  if (ggbReady && on !== ggb3d) {
    try { ggbApplet.setPerspective(on ? "+T" : "-T"); } catch (e) { console.warn("[MathApp] vista 3D non applicata", e); }
  }
  ggb3d = on;
  updateViewButton();
}
$("#view3d").addEventListener("click", () => { setView3d(!ggb3d); saveState(); });
updateViewButton();

// ---------- finestra del grafico: vista 2D personalizzata ----------
// La finestra [xmin,xmax]x[ymin,ymax] dell'applet si legge dall'XML (coordSystem + size)
// e si applica con setCoordSystem; assi e griglia con le API dedicate.
let viewCustom = null; // ultimo riquadro applicato {xmin,xmax,ymin,ymax,axes,grid}
let viewCache = null; // ultima finestra letta bene (con la lavagna nascosta l'XML non ha la misura: si riusa questa)

function viewFinite(v) {
  return !!v && [v.xmin, v.xmax, v.ymin, v.ymax].every((n) => Number.isFinite(n)) && v.xmin < v.xmax && v.ymin < v.ymax;
}

const fmtViewNum = (v) => (Number.isFinite(v) ? String(Math.round(v * 1e6) / 1e6) : "");

function viewFromBoard() {
  if (!ggbReady) return viewCache;
  try {
    const block = (ggbApplet.getXML().match(/<euclidianView>[\s\S]*?<\/euclidianView>/) || [""])[0];
    if (!block) return viewCache;
    const tag = (re) => (block.match(re) || [""])[0];
    const num = (t, name) => { const m = String(t).match(new RegExp("\\b" + name + '="([^"]+)"')); return m ? parseFloat(m[1]) : NaN; };
    const flag = (t, name) => { const m = String(t).match(new RegExp("\\b" + name + '="([^"]+)"')); return m ? m[1] === "true" : null; };
    const sizeTag = tag(/<size [^>]*>/), csTag = tag(/<coordSystem [^>]*>/), evTag = tag(/<evSettings [^>]*>/);
    const W = num(sizeTag, "width"), H = num(sizeTag, "height");
    const x0 = num(csTag, "xZero"), y0 = num(csTag, "yZero"), sx = num(csTag, "scale"), sy = num(csTag, "yscale");
    if (![W, H, x0, y0, sx, sy].every(Number.isFinite) || sx <= 0 || sy <= 0) return viewCache;
    const rec = {
      xmin: -x0 / sx, xmax: (W - x0) / sx,
      ymin: (y0 - H) / sy, ymax: y0 / sy,
      axes: flag(evTag, "axes"), grid: flag(evTag, "grid"),
    };
    if (viewFinite(rec)) { viewCache = rec; return rec; }
    return viewCache;
  } catch { return viewCache; }
}

function applyViewToBoard(rec) {
  if (!ggbReady || ggb3d || !viewFinite(rec)) return false;
  let done = false;
  try { ggbApplet.setCoordSystem(rec.xmin, rec.xmax, rec.ymin, rec.ymax); done = true; } catch (e) { console.warn("[MathApp] setCoordSystem non riuscito", e); }
  if (!done) {
    try { ggbApplet.evalCommand("ZoomIn(" + fmtViewNum(rec.xmin) + "," + fmtViewNum(rec.ymin) + "," + fmtViewNum(rec.xmax) + "," + fmtViewNum(rec.ymax) + ")"); done = true; } catch {}
  }
  if (!done) return false;
  viewCache = rec; // anche a lavagna nascosta la finestra applicata è quella giusta
  try { if (typeof rec.axes === "boolean" && ggbApplet.setAxesVisible) ggbApplet.setAxesVisible(rec.axes, rec.axes); } catch {}
  try { if (typeof rec.grid === "boolean" && ggbApplet.setGridVisible) ggbApplet.setGridVisible(rec.grid); } catch {}
  return true;
}

function viewPanelSync() {
  const cur = viewFromBoard() || viewCustom;
  const base = cur || { xmin: -10, xmax: 10, ymin: -10, ymax: 10 };
  const set = (id, v) => { const el = $(id); if (el) el.value = fmtViewNum(v); };
  set("#vxmin", base.xmin); set("#vxmax", base.xmax); set("#vymin", base.ymin); set("#vymax", base.ymax);
  const ax = $("#vaxes"), gr = $("#vgrid");
  if (ax) ax.checked = cur && cur.axes !== null && cur.axes !== undefined ? !!cur.axes : true;
  if (gr) gr.checked = !!(cur && cur.grid);
}

function applyView(rec, persist) {
  if (ggb3d) { flash("la finestra vale per il piano 2D: prima esci dalla vista 3D"); return false; }
  if (!applyViewToBoard(rec)) { flash("finestra non applicata"); return false; }
  viewCustom = rec;
  viewPanelSync();
  if (persist !== false) saveState();
  return true;
}

const viewPanel = $("#viewPanel");
function setViewPanel(open) {
  if (!viewPanel) return;
  viewPanel.hidden = !open;
  const b = $("#viewBtn");
  if (b) { b.classList.toggle("is-on", !!open); b.setAttribute("aria-expanded", String(!!open)); }
  if (open) viewPanelSync();
}

if (viewPanel) {
  $("#viewBtn").addEventListener("click", () => setViewPanel(viewPanel.hidden));
  $("#viewClose").addEventListener("click", () => setViewPanel(false));
  document.addEventListener("click", (e) => {
    if (viewPanel.hidden) return;
    if (viewPanel.contains(e.target) || $("#viewBtn").contains(e.target)) return;
    setViewPanel(false);
  });
  $("#viewApply").addEventListener("click", () => {
    const num = (id) => parseFloat(String($(id).value).replace(",", "."));
    const rec = { xmin: num("#vxmin"), xmax: num("#vxmax"), ymin: num("#vymin"), ymax: num("#vymax"), axes: $("#vaxes").checked, grid: $("#vgrid").checked };
    if (!viewFinite(rec)) { flash("controlla gli intervalli: il minimo dev'essere minore del massimo"); return; }
    if (applyView(rec)) flash("finestra applicata");
  });
  $("#viewStd").addEventListener("click", () => { if (applyView({ xmin: -10, xmax: 10, ymin: -10, ymax: 10, axes: true, grid: false })) flash("finestra standard"); });
  $("#viewFit").addEventListener("click", () => { if (!fitToContent()) flash("niente da inquadrare: disegna prima una funzione o dei punti"); });
}

// ---------- "Adatta": inquadra funzioni e punti notevoli ----------
function latestDrawCell() {
  for (let i = cellData.length - 1; i >= 0; i--) {
    const c = cellData[i];
    if (c && c.res && c.res.draw) return c.res;
  }
  return null;
}

function collectFitPoints() {
  const pts = [];
  const lastFig = figures[figures.length - 1];
  if (lastFig) for (const c of lastFig.commands) {
    const m = String(c).match(/^\s*[A-Za-z][\w']*\s*=\s*\(\s*(-?[\d.]+)\s*,\s*(-?[\d.]+)\s*[,)]/);
    if (m) pts.push({ x: parseFloat(m[1]), y: parseFloat(m[2]) });
  }
  const lastDraw = latestDrawCell();
  if (lastDraw && lastDraw.draw && Array.isArray(lastDraw.draw.punti)) for (const p of lastDraw.draw.punti) {
    const x = Number(p.x), y = Number(p.y);
    if (Number.isFinite(x) && Number.isFinite(y)) pts.push({ x, y });
  }
  return pts;
}

// campiona f(x) facendo calcolare il valore a GeoGebra (variabile temporanea zzFit)
function sampleFnY(name, x) {
  try {
    if (!ggbApplet.evalCommand("zzFit = " + name + "(" + fmtViewNum(x) + ")")) return null;
    const v = Number(ggbApplet.getValue("zzFit"));
    return Number.isFinite(v) ? v : null;
  } catch { return null; }
}

function fitToContent(opts) {
  if (!ggbReady || ggb3d) return false;
  const pts = collectFitPoints().concat((opts && opts.points) || []);
  const fns = ((opts && opts.functions) || []).slice();
  const lastFig = figures[figures.length - 1];
  if (lastFig) for (const c of lastFig.commands) {
    const m = String(c).match(/^\s*([A-Za-z]\w*)\s*\(x\)\s*=/);
    if (m) fns.push(m[1]);
  }
  const lastDraw = latestDrawCell();
  if (lastDraw && lastDraw.kind === "studio" && lastDraw.draw && lastDraw.draw.funzione) fns.push("f");
  const cur = viewFromBoard();
  let xmin = Infinity, xmax = -Infinity;
  for (const p of pts) { if (p.x < xmin) xmin = p.x; if (p.x > xmax) xmax = p.x; }
  if (Number.isFinite(xmin)) {
    if (xmax - xmin < 1e-9) { const c0 = (xmin + xmax) / 2 || 0; xmin = c0 - 2; xmax = c0 + 2; }
    const padX = Math.min(Math.max(0.35 * (xmax - xmin), 1), 50);
    xmin -= padX; xmax += padX;
  } else if (fns.length && cur) { xmin = cur.xmin; xmax = cur.xmax; }
  else return false;
  const ys = [];
  for (const p of pts) if (Number.isFinite(p.y) && Math.abs(p.y) < 1e6) ys.push(p.y);
  if (fns.length) {
    let names = [];
    try { names = ggbApplet.getAllObjectNames(); } catch {}
    const valid = fns.filter((nm, i) => names.includes(nm) && fns.indexOf(nm) === i);
    if (valid.length && !names.includes("zzFit")) {
      for (const nm of valid) {
        for (let i = 0; i <= 120; i++) {
          const y = sampleFnY(nm, xmin + ((xmax - xmin) * i) / 120);
          if (y !== null && Math.abs(y) < 1e6) ys.push(y);
        }
      }
      try { ggbApplet.deleteObject("zzFit"); } catch {}
    }
  }
  if (!ys.length) return false;
  ys.sort((a, b) => a - b);
  const pick = (q) => ys[Math.min(ys.length - 1, Math.max(0, Math.floor(q * (ys.length - 1))))];
  let ymin = pick(0.02), ymax = pick(0.98);
  if (!(ymax > ymin)) { ymin = ys[0]; ymax = ys[ys.length - 1]; }
  if (ymax - ymin < 1e-9) { const c1 = (ymin + ymax) / 2 || 0; ymin = c1 - 2; ymax = c1 + 2; }
  const padY = 0.1 * (ymax - ymin);
  const base = viewCustom || cur || { axes: true, grid: false };
  return applyView({ xmin, xmax, ymin: ymin - padY, ymax: ymax + padY, axes: base.axes !== false, grid: base.grid === true });
}

// Scheda di una costruzione: comandi in chiaro, si rivede e si esegue quando vuoi.
function renderFigureCard(parent, fig, opts) {
  const collapsed = !!(opts && opts.collapsed);
  const card = document.createElement("div");
  card.className = "ggb-card";
  card.dataset.fid = fig.fid;
  const head = document.createElement("div"); head.className = "ggb-card-head";
  const dot = document.createElement("span"); dot.className = "fig-dot";
  const name = document.createElement("b"); name.textContent = fig.title || "Figura";
  const hint = document.createElement("span"); hint.className = "fig-hint"; hint.textContent = "controlla i comandi, poi esegui";
  head.append(dot, name);
  if (fig.view === "3d") {
    const tag = document.createElement("span"); tag.className = "fig-3d"; tag.textContent = "3D";
    tag.title = "Questa costruzione vive nella vista 3D";
    head.appendChild(tag);
  }
  head.appendChild(hint);
  const ta = document.createElement("textarea");
  ta.className = "ggb-cmds";
  ta.value = (fig.commands || []).join("\n");
  ta.rows = Math.min(8, Math.max(2, (fig.commands || []).length));
  ta.spellcheck = false;
  ta.hidden = collapsed;
  const actions = document.createElement("div"); actions.className = "ggb-actions";
  const mk = (label, cls, title) => { const b = document.createElement("button"); b.type = "button"; b.textContent = label; if (cls) b.className = cls; if (title) b.title = title; return b; };
  const show = mk("Esegui", "ggb-run", "Ripulisce il grafico e disegna questa costruzione");
  const add = mk("Aggiungi", "", "Disegna questa costruzione sopra quello che c'e' gia'");
  const toggle = mk(collapsed ? "Comandi" : "Nascondi comandi", "", "Mostra/nascondi i comandi modificabili");
  const state = document.createElement("span"); state.className = "ggb-state";
  actions.append(show, add, toggle, state);

  const readCmds = () => {
    const list = ta.value.split("\n").map((s) => s.trim()).filter(Boolean);
    if (list.length) fig.commands = list;
    return fig.commands;
  };
  show.addEventListener("click", async () => { readCmds(); state.textContent = "eseguo…"; const r = await runFigure(fig, "replace"); state.textContent = "eseguita (" + r.okN + "/" + r.total + ")"; card.classList.add("done"); if (r.okN < r.total) openDetailsNear(card); });
  add.addEventListener("click", async () => { readCmds(); state.textContent = "aggiungo…"; const r = await runFigure(fig, "add"); state.textContent = "aggiunta (" + r.okN + "/" + r.total + ")"; card.classList.add("done"); if (r.okN < r.total) openDetailsNear(card); });
  toggle.addEventListener("click", () => {
    ta.hidden = !ta.hidden;
    toggle.textContent = ta.hidden ? "Comandi" : "Nascondi comandi";
    if (ta.hidden) { readCmds(); saveState(); } else ta.focus();
  });

  card.append(head, ta, actions);
  parent.appendChild(card);
  stick();
  return card;
}

$("#undoFig").addEventListener("click", boardUndo);
$("#redoFig").addEventListener("click", boardRedo);
$("#saveFig").addEventListener("click", async () => {
  const url = await boardPngData();
  if (!url) { flash("la lavagna è vuota: niente da salvare"); return; }
  const a = document.createElement("a");
  a.href = url; a.download = "mathapp-lavagna.png"; a.click();
  flash("immagine della lavagna scaricata");
});

$("#clearFigs").addEventListener("click", () => {
  if (streaming || conversationLoading) { flash("attendi il caricamento o la risposta in corso…"); return; }
  if (!figures.length) { flash("nessuna costruzione da svuotare"); return; }
  figures = []; figSeq = 0;
  for (const c of [...chatEl.querySelectorAll(".ggb-card")]) c.remove();
  refreshFigureList();
  const generation = conversationGeneration;
  queueGgbClear(generation).then(() => { if (generation === conversationGeneration) saveState(); });
  flash("costruzioni svuotate");
});

$("#figSel").addEventListener("change", async (e) => {
  const fid = e.target.value;
  e.target.value = "";
  if (conversationLoading) { flash("attendi il caricamento dell'argomento…"); return; }
  if (!fid) return;
  const fig = figures.find((f) => f.fid === fid);
  if (!fig) return;
  const card = document.querySelector('.ggb-card[data-fid="' + fid + '"]');
  const st = card ? card.querySelector(".ggb-state") : null;
  if (st) st.textContent = "mostro…";
  const r = await runFigure(fig, "replace");
  if (st) { st.textContent = "eseguita (" + r.okN + "/" + r.total + ")"; card.classList.add("done"); }
});

// modifica geometria esistente via API GeoGebra
async function execEdits(callId, ops, expectedGeneration = conversationGeneration) {
  await ggbReadyPromise;
  if (expectedGeneration !== conversationGeneration) return;
  pushUndoPoint(); // annulla = riconduce la lavagna a prima di questa modifica
  const results = [];
  for (const o of ops) {
    try {
      switch (o.op) {
        case "movePoint": ggbApplet.setCoords(o.name, o.x, o.y); break;
        case "setValue": ggbApplet.setValue(o.name, o.value); break;
        case "setColor": ggbApplet.setColor(o.name, o.r, o.g, o.b); break;
        case "setVisible": ggbApplet.setVisible(o.name, !!o.visible); break;
        case "setCaption": ggbApplet.setCaption(o.name, o.text || ""); break;
        case "setLineThickness": ggbApplet.setLineThickness(o.name, o.thickness || 3); break;
        case "setAnimating": ggbApplet.setAnimating(o.name, !!o.on); break;
        case "startAnimation": ggbApplet.startAnimation(); break;
        case "stopAnimation": ggbApplet.stopAnimation(); break;
        case "delete": ggbApplet.deleteObject(o.name); break;
        default: results.push({ op: o.op, ok: false, error: "op sconosciuta" }); continue;
      }
      results.push({ op: o.op, name: o.name, ok: true });
    } catch (e) { results.push({ op: o.op, name: o.name, ok: false, error: String(e) }); }
  }
  pushUndoPoint(); // …e ripeti = riapplica la modifica
  try {
    await fetch("/api/geogebra-result", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ callId, results }),
    });
  } catch {}
}

// ---------- markdown + katex ----------
// Corregge la notazione dentro le formule: "*" -> \cdot (e evita che markdown lo renda corsivo).
function fixMathNotation(text) {
  return String(text || "").replace(/(\$\$[\s\S]*?\$\$|\$[^$\n]+?\$)/g, (m) =>
    m.replace(/(?<!\\)\*(?![{}])/g, "\\cdot ")      // a*b -> a \cdot b
     .replace(/\\qquad/g, "\\quad ")                  // spaziatura piu' sobria
     .replace(/(\\quad\s*){2,}/g, "\\quad ")          // niente catene di spazi
  );
}

const SAFE_MD_TAGS = new Set([
  "a", "p", "br", "hr", "strong", "em", "del", "s", "b", "i", "u",
  "sub", "sup", "kbd", "samp", "mark", "blockquote", "pre", "code",
  "h1", "h2", "h3", "h4", "h5", "h6", "ul", "ol", "li", "table",
  "thead", "tbody", "tfoot", "tr", "th", "td", "div", "span",
]);
const DROP_MD_TAGS = new Set([
  "script", "style", "iframe", "object", "embed", "svg", "math", "template",
  "noscript", "form", "input", "button", "textarea", "select", "option",
  "video", "audio", "source", "link", "meta", "base",
]);

function safeMarkdownHref(raw) {
  const value = String(raw || "").trim();
  if (!value || /[\u0000-\u001f\u007f]/.test(value)) return null;
  if (value.startsWith("#")) return value;
  try {
    const url = new URL(value, window.location.href);
    return ["http:", "https:", "mailto:"].includes(url.protocol) ? value : null;
  } catch { return null; }
}

function copySafeMarkdownNode(source, parent) {
  if (source.nodeType === Node.TEXT_NODE) {
    parent.appendChild(document.createTextNode(source.nodeValue || ""));
    return;
  }
  if (source.nodeType !== Node.ELEMENT_NODE) return;

  const tag = source.localName.toLowerCase();
  if (DROP_MD_TAGS.has(tag)) return;
  if (!SAFE_MD_TAGS.has(tag)) {
    for (const child of source.childNodes) copySafeMarkdownNode(child, parent);
    return;
  }

  const clean = document.createElement(tag);
  if (tag === "a") {
    const href = safeMarkdownHref(source.getAttribute("href"));
    if (href) clean.setAttribute("href", href);
    const title = source.getAttribute("title");
    if (title) clean.setAttribute("title", title.slice(0, 300));
    clean.setAttribute("rel", "noopener noreferrer");
  } else if (tag === "code") {
    const language = (source.getAttribute("class") || "").split(/\s+/)
      .find((name) => /^language-[a-z0-9_+.-]{1,32}$/i.test(name));
    if (language) clean.className = language;
  } else if (tag === "ol") {
    const start = source.getAttribute("start");
    if (start && /^\d{1,5}$/.test(start)) clean.setAttribute("start", start);
  } else if (tag === "th" || tag === "td") {
    const align = source.getAttribute("align");
    if (["left", "center", "right"].includes(align)) clean.setAttribute("align", align);
  }

  for (const child of source.childNodes) copySafeMarkdownNode(child, clean);
  parent.appendChild(clean);
}

function sanitizeMarkdown(html) {
  // I template restano inerti: gli handler e gli script del frammento non vengono eseguiti.
  const template = document.createElement("template");
  template.innerHTML = String(html || "");
  const safe = document.createDocumentFragment();
  for (const child of template.content.childNodes) copySafeMarkdownNode(child, safe);
  return safe;
}

function renderMD(el, text) {
  const src = fixMathNotation(text);
  if (window.marked) el.replaceChildren(sanitizeMarkdown(window.marked.parse(src)));
  else el.textContent = src;
  if (window.renderMathInElement) {
    renderMathInElement(el, {
      delimiters: [
        { left: "$$", right: "$$", display: true },
        { left: "$", right: "$", display: false },
        { left: "\\[", right: "\\]", display: true },
        { left: "\\(", right: "\\)", display: false },
      ],
      throwOnError: false,
    });
  }
}

// ---------- chat ----------
// Auto-scroll rispettoso: se stai leggendo più in alto, non ti riporta giù.
const jumpBtn = $("#jumpBtn");
let autoFollow = true;
const atBottom = () => chatEl.scrollHeight - chatEl.scrollTop - chatEl.clientHeight < 80;
function stick(force) {
  if (force || autoFollow) {
    chatEl.scrollTop = chatEl.scrollHeight;
    if (jumpBtn) jumpBtn.hidden = true;
  } else if (jumpBtn) {
    jumpBtn.hidden = false;
  }
}
chatEl.addEventListener("scroll", () => {
  autoFollow = atBottom();
  if (autoFollow && jumpBtn) jumpBtn.hidden = true;
});
if (jumpBtn) jumpBtn.addEventListener("click", () => { autoFollow = true; stick(true); });

function addMsg(role) {
  const d = document.createElement("div");
  d.className = "msg " + role;
  chatEl.appendChild(d);
  stick();
  return d;
}

let streaming = false;

function makeUserBubble(text, atts) {
  const d = addMsg("user");
  const body = document.createElement("div");
  body.className = "user-text";
  body.textContent = text;
  d.appendChild(body);
  if (atts && atts.length) d.appendChild(attachListEl(atts.map((a) => a.name)));
  const btn = document.createElement("button");
  btn.type = "button"; btn.className = "edit-btn"; btn.title = "Modifica e ottieni un'altra risposta"; btn.textContent = "✎";
  btn.addEventListener("click", () => startEdit(d));
  d.appendChild(btn);
  return d;
}

async function send(text) {
  if (streaming || conversationLoading) return;
  const atts = pending.slice();
  pending = []; renderChips();
  const um = { role: "user", content: text };
  if (atts.length) um.attachments = atts;
  messages.push(um);
  const b = makeUserBubble(text, atts);
  b.dataset.idx = messages.length - 1;
  try { localStorage.removeItem("mathapp.empty"); } catch {}
  autoFollow = true; stick(true);
  await runTurn();
}

async function runTurn() {
  if (streaming || conversationLoading) return;
  const turnGeneration = conversationGeneration;
  const turnAbort = new AbortController();
  streaming = true; setSendStop(true); statusEl.textContent = "sta pensando…";
  currentAbort = turnAbort;
  const bubble = addMsg("assistant");
  const think = document.createElement("div"); think.className = "thinking"; think.style.display = "none";
  bubble.appendChild(think);
  const body = document.createElement("div");
  body.className = "msg-body";
  bubble.appendChild(body);
  // i passaggi interni (tool) stanno richiusi: non sporcano la chat, ma si aprono se c'e' un errore
  const toolsBox = document.createElement("details");
  toolsBox.className = "tools-details";
  const toolsSummary = document.createElement("summary");
  toolsSummary.textContent = "⚙ dettagli";
  toolsBox.appendChild(toolsSummary);
  const toolsRow = document.createElement("div"); toolsRow.className = "tools";
  toolsBox.appendChild(toolsRow);
  let toolCount = 0;
  const addToolLine = (el) => { toolsRow.appendChild(el); toolCount++; toolsSummary.textContent = "⚙ dettagli (" + toolCount + ")"; };
  const showDetails = () => { toolsBox.open = true; toolsBox.classList.add("has-error"); };
  bubble.appendChild(toolsBox);

  let acc = "", reasoning = "", lastRender = 0, queued = false, finished = false;
  const rerender = () => {
    queued = false; lastRender = Date.now();
    if (finished || turnGeneration !== conversationGeneration) return; // niente render tardivi o su un'altra chat
    renderMD(body, acc);
    stick();
  };

  try {
    const res = await fetch("/api/chat", {
      method: "POST", headers: { "Content-Type": "application/json" },
      signal: turnAbort.signal,
      body: JSON.stringify({ messages, model: currentModel, sessionId, conversationId, mode, tutorMode: tutorMode || (stepMode ? "step" : null), dark: document.body.classList.contains("theme-dark") }),
    });
    if (!res.ok) throw new Error("HTTP " + res.status + ": " + (await res.text()).slice(0, 300));
    const reader = res.body.getReader();
    const dec = new TextDecoder();
    let buf = "";
    while (true) {
      const { done, value } = await reader.read();
      if (turnGeneration !== conversationGeneration) {
        try { await reader.cancel(); } catch {}
        return;
      }
      if (done) break;
      buf += dec.decode(value, { stream: true });
      let i;
      while ((i = buf.indexOf("\n\n")) >= 0) {
        const block = buf.slice(0, i); buf = buf.slice(i + 2);
        const ev = (block.match(/^event:\s*(.*)$/m) || [])[1] || "message";
        const dataLine = (block.match(/^data:\s*(.*)$/m) || [])[1] || "{}";
        let data = {}; try { data = JSON.parse(dataLine); } catch {}
        if (ev === "delta") {
          acc += data.text || "";
          if (!queued && Date.now() - lastRender > 100) { queued = true; requestAnimationFrame(rerender); }
        } else if (ev === "reasoning") {
          reasoning += data.text || "";
          think.style.display = "block"; think.textContent = "🧠 " + reasoning.slice(-400);
        } else if (ev === "tool") {
          const line = document.createElement("div");
          line.appendChild(document.createTextNode("🔧 "));
          const name = document.createElement("code");
          name.textContent = String(data.name || "tool");
          line.append(name, document.createTextNode(" " + JSON.stringify(data.args || {}).slice(0, 120)));
          addToolLine(line);
        } else if (ev === "notice") {
          const line = document.createElement("div");
          line.className = "notice";
          line.textContent = "ℹ " + data.text;
          bubble.appendChild(line); // le notizie utili restano sempre visibili
          if (/Appunti/i.test(data.text) && !$("#kbDrawer").hidden) refreshKb(); // lista aggiornata se il pannello è aperto
        } else if (ev === "sympy_result") {
          const a2 = data.args || {};
          addCell(a2.operation, a2.expr || a2.vectors || a2.matrix || "", data.result, true);
          const r = data.result || {};
          if (r.ok) {
            const vb = document.createElement("div");
            vb.className = "vbadge";
            vb.textContent = "✔ verificato con SymPy · " + (a2.operation || "") + "(" + (a2.expr || a2.vectors || a2.matrix || "") + ") = " + String(r.result).slice(0, 140);
            bubble.appendChild(vb);
          } else showDetails();
        } else if (ev === "sources") {
          pendingSources = data; // mostrato a fine risposta, e solo se davvero ripreso
        } else if (ev === "usage") {
          usageTot.prompt += data.prompt || 0;
          usageTot.completion += data.completion || 0;
          usageTot.total += data.total || 0;
          const u = $("#usage");
          if (u) u.textContent = "tok " + usageTot.total.toLocaleString("it-IT");
        } else if (ev === "geogebra") {
          const cmds = data.commands || [];
          const fig = { fid: data.fid || crypto.randomUUID(), title: data.title || ("Figura " + (++figSeq)), commands: cmds.slice(), msgIdx: null, view: data.view === "3d" ? "3d" : "2d" };
          figures.push(fig);
          const line = document.createElement("div");
          line.appendChild(document.createTextNode("📐 Costruzione "));
          const title = document.createElement("b");
          title.textContent = String(fig.title);
          line.append(title, document.createTextNode(" (" + cmds.length + " comandi" + (fig.view === "3d" ? ", vista 3D" : "") + ")"));
          addToolLine(line);
          const card = renderFigureCard(bubble, fig);
          refreshFigureList();
          // va SUBITO sul grafico (cosi' la spiegazione corrisponde); la scheda resta per modificarla o rieseguirla
          const md = data.mode === "add" ? "add" : "replace";
          runFigure(fig, md, turnGeneration).then((r) => {
            if (turnGeneration !== conversationGeneration) return;
            postGgbResult(data.callId, { okN: r.okN, total: r.total, mode: md });
            const st = card.querySelector(".ggb-state");
            if (st) st.textContent = (md === "add" ? "aggiunta" : "eseguita") + " (" + r.okN + "/" + r.total + ")";
            card.classList.add("done");
            if (r.okN < r.total) showDetails(); // comandi falliti: mostra i dettagli
          });
        } else if (ev === "geogebra_edit") {
          const line = document.createElement("div");
          line.appendChild(document.createTextNode("🛠 GeoGebra edit: "));
          const code = document.createElement("code");
          code.textContent = JSON.stringify(data.ops || []).slice(0, 200);
          line.appendChild(code);
          addToolLine(line);
          execEdits(data.callId, data.ops || [], turnGeneration);
        } else if (ev === "error") {
          body.classList.add("err"); acc += "\n\n**Errore:** " + data.message;
          showDetails();
        }
      }
    }
  } catch (e) {
    if (turnGeneration !== conversationGeneration) return;
    if (e && e.name === "AbortError") { acc += "\n\n*— interrotto —*"; }
    else { body.classList.add("err"); acc += "\n\n**Errore:** " + e.message; }
  }
  if (turnGeneration !== conversationGeneration) return;
  finished = true;
  renderMD(body, acc);
  think.style.display = "none";
  messages.push({ role: "assistant", content: acc });
  bubble.dataset.idx = messages.length - 1;
  const myIdx = Number(bubble.dataset.idx);
  for (const f of figures) if (f.msgIdx == null) f.msgIdx = myIdx;
  if (stepMode) applySteps(bubble, body);
  ensureFigureCards();
  placeFigureCards(bubble, body);
  renderSources(bubble, pendingSources, acc);
  pendingSources = null;
  addMsgActions(bubble, myIdx);
  saveState();
  streaming = false; setSendStop(false);
  if (currentAbort === turnAbort) currentAbort = null;
  statusEl.textContent = "";
  stick();
}

// ---------- modifica di un messaggio già inviato ----------
function startEdit(bubble) {
  if (streaming || conversationLoading) { flash("attendi il caricamento o la risposta in corso…"); return; }
  const idx = Number(bubble.dataset.idx);
  const msg = messages[idx];
  if (!msg || msg.role !== "user") return;
  if (bubble.querySelector(".msg-edit")) return;

  // allegati reinviabili (contenuto completo) + nomi di allegati salvati (solo nome)
  const editAtts = (msg.attachments || []).slice();
  const legacyNames = (msg.files || []).filter((n) => !editAtts.some((a) => a.name === n));

  const box = document.createElement("div"); box.className = "msg-edit";
  const chips = document.createElement("div"); chips.className = "attach-chips";

  const renderChipsEdit = () => {
    chips.innerHTML = "";
    chips.hidden = editAtts.length === 0 && legacyNames.length === 0;
    editAtts.forEach((a, i) => {
      const c = document.createElement("span"); c.className = "chip";
      const b = document.createElement("b"); b.textContent = fileIcon(a) + " " + a.name;
      const s = document.createElement("span"); s.textContent = fmtSize(a.size || Math.round((a.b64 || "").length * 0.75));
      const x = document.createElement("button"); x.type = "button"; x.textContent = "✕"; x.title = "Rimuovi";
      x.addEventListener("click", () => { editAtts.splice(i, 1); renderChipsEdit(); });
      c.append(b, s, x);
      chips.appendChild(c);
    });
    for (const n of legacyNames) {
      const c = document.createElement("span");
      c.className = "chip-static";
      c.title = "Allegato di una conversazione salvata: ri-allegalo per usarlo di nuovo";
      c.textContent = "📎 " + n + " (da ri-allegare)";
      chips.appendChild(c);
    }
  };
  renderChipsEdit();

  const ta = document.createElement("textarea");
  ta.value = msg.content;
  ta.rows = Math.max(2, Math.min(10, ta.value.split("\n").length + 1));

  const input = document.createElement("input");
  input.type = "file"; input.multiple = true; input.hidden = true;

  const addToEdit = async (list) => {
    for (const f of Array.from(list || [])) {
      if (editAtts.length >= MAX_FILES) { flash("massimo " + MAX_FILES + " allegati"); break; }
      if (f.size > MAX_FILE) { flash("«" + f.name + "» troppo grande (max 8 MB)"); continue; }
      const a = await readFile(f);
      if (a) editAtts.push(a);
    }
    renderChipsEdit();
  };
  input.addEventListener("change", (e) => { addToEdit(e.target.files); e.target.value = ""; });
  ta.addEventListener("paste", (e) => {
    const fs = e.clipboardData && e.clipboardData.files;
    if (fs && fs.length) { e.preventDefault(); addToEdit(fs); }
  });
  box.addEventListener("dragover", (e) => { e.preventDefault(); box.classList.add("drop-target"); });
  box.addEventListener("dragleave", () => box.classList.remove("drop-target"));
  box.addEventListener("drop", (e) => {
    e.preventDefault(); box.classList.remove("drop-target");
    if (e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files.length) addToEdit(e.dataTransfer.files);
  });

  const actions = document.createElement("div"); actions.className = "msg-edit-actions";
  const addBtn = document.createElement("button"); addBtn.type = "button"; addBtn.className = "edit-attach"; addBtn.textContent = "Allega";
  const save = document.createElement("button"); save.type = "button"; save.className = "edit-save"; save.textContent = "Salva e rinvia";
  const cancel = document.createElement("button"); cancel.type = "button"; cancel.className = "edit-cancel"; cancel.textContent = "Annulla";
  const hint = document.createElement("span"); hint.className = "edit-hint"; hint.textContent = "la conversazione riparte da qui";
  actions.append(addBtn, save, cancel, hint);

  box.append(chips, ta, input, actions);
  bubble.appendChild(box);
  ta.focus();
  ta.setSelectionRange(ta.value.length, ta.value.length);

  const close = () => box.remove();
  addBtn.addEventListener("click", () => input.click());
  cancel.addEventListener("click", close);
  ta.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); save.click(); }
    if (e.key === "Escape") close();
  });
  save.addEventListener("click", async () => {
    const t = ta.value.trim();
    if (!t) return;
    close();
    await editAndResend(idx, t, editAtts);
  });
}

async function editAndResend(idx, newText, atts) {
  for (const el of [...chatEl.querySelectorAll("[data-idx]")]) {
    if (Number(el.dataset.idx) >= idx) el.remove();
  }
  for (const f of figures) if (f.msgIdx != null && f.msgIdx >= idx) f.msgIdx = null; // riattacco dopo
  messages = messages.slice(0, idx);
  const um = { role: "user", content: newText };
  if (atts && atts.length) um.attachments = atts.slice();
  messages.push(um);
  const b = makeUserBubble(newText, atts);
  b.dataset.idx = idx;
  autoFollow = true; stick(true);
  await runTurn();
  flash("risposta rigenerata");
}

// ---------- modalità Figura / Algebra ----------
function renderMathInto(el) {
  if (!window.renderMathInElement) return;
  renderMathInElement(el, {
    delimiters: [{ left: "$$", right: "$$", display: true }, { left: "$", right: "$", display: false }],
    throwOnError: false,
  });
}

function setMode(m, allowDuringLoad = false) {
  if (conversationLoading && !allowDuringLoad) return;
  mode = m === "algebra" ? "algebra" : "figure";
  const isAlg = mode === "algebra";
  const active = (sel, on) => { const el = $(sel); el.classList.toggle("is-active", on); el.setAttribute("aria-pressed", String(on)); };
  active("#modeFigure", !isAlg);
  active("#modeAlgebra", isAlg);
  mainEl.classList.toggle("algebra-mode", isAlg);
  $("#panelAlgebra").hidden = !isAlg;
  $("#toggleGgb").style.display = isAlg ? "none" : "";
  updateExtra();
  window.dispatchEvent(new Event("resize"));
  saveState();
  // al ritorno sulla figura, riallinea e ridisegna l'applet
  setTimeout(() => {
    if (!ggbReady) return;
    try {
      ggbResize();
      if (ggbApplet.refreshViews) ggbApplet.refreshViews();
    } catch {}
  }, 80);
}

// ---------- quaderno di algebra ----------
const OP_LABEL = { simplify: "semplificazione", expand: "espansione", factor: "fattorizzazione", diff: "derivata", integrate: "integrale", limit: "limite", solve: "soluzione", series: "serie", evaluate: "valutazione", det: "determinante", inverse: "inversa", rank: "rango", transpose: "trasposta", studio: "studio di funzione", stats: "statistica", regressione: "regressione lineare", complesso: "numeri complessi", parziali: "somme parziali", sistema: "sistema di equazioni", dot: "prodotto scalare", cross: "prodotto vettoriale", norm: "norma", angle: "angolo", projection: "proiezione", independence: "indipendenza", gram_schmidt: "Gram-Schmidt" };
const VECTOR_OPS = new Set(["dot", "cross", "norm", "angle", "projection", "independence", "gram_schmidt"]);
const calcForm = $("#calcForm"), calcExpr = $("#calcExpr"), calcOp = $("#calcOp"), calcCells = $("#calcCells");

function updateExtra() {
  const op = calcOp.value;
  $("#labVar").hidden = !["diff", "integrate", "limit", "series", "parziali"].includes(op);
  $("#labA").hidden = op !== "integrate";
  $("#labB").hidden = !(op === "integrate" || op === "limit");
  $("#labB").firstChild.textContent = op === "limit" ? "punto " : "a ";
  $("#labOrder").hidden = !(op === "diff" || op === "series" || op === "parziali");
  $("#calcOrder").placeholder = op === "diff" ? "1" : op === "parziali" ? "10" : "6";
  if (op === "parziali") $("#labOrder").firstChild.textContent = "quante ";
  else $("#labOrder").firstChild.textContent = "ordine ";
  if (op === "parziali" && (calcVar.value.trim() === "x" || !calcVar.value.trim())) calcVar.value = "n";
  const hint = $("#calcHint");
  if (hint) {
    hint.textContent = op === "studio"
      ? "es. f(x)=x^2-3x+2 — referto con dominio, zeri, limiti, asintoti, derivata… e pulsante Disegna"
      : op === "stats"
        ? "es. 1, 2, 2, 3, 9 — media, mediana, moda, varianza, quartili…"
        : op === "regressione"
          ? "es. 1,2; 2,4; 3,5; 4,6 — punti x,y separati da «;», retta e correlazione"
          : op === "complesso"
            ? "es. 3+4i oppure (3+4i)/(1-2i) — forma algebrica, modulo, argomento e disegno nel piano"
            : op === "parziali"
              ? "es. 1/n^2 con variabile n — somme S1…SN e somma della serie"
              : op === "sistema"
                ? "es. x+y=3; x-y=1 — due equazioni separate da «;», soluzione e disegno delle rette"
                : VECTOR_OPS.has(op)
                  ? "es. [[1,2],[3,4]] — una lista per vettore; i vettori 2D/3D si disegnano con Disegna"
                  : "Invio per calcolare · ↑ richiama l'ultima espressione";
  }
}

// richiama le ultime espressioni con ↑/↓ (come una shell)
let calcHistory = [], calcHistIdx = -1;
function rememberCalc(expr) {
  if (!expr) return;
  calcHistory = [expr, ...calcHistory.filter((e) => e !== expr)].slice(0, 20);
  calcHistIdx = -1;
}
calcExpr.addEventListener("keydown", (e) => {
  if (e.key !== "ArrowUp" && e.key !== "ArrowDown") return;
  if (!calcHistory.length) return;
  if (e.key === "ArrowUp") {
    if (calcExpr.value.trim() && calcHistIdx < 0) return; // stai scrivendo: non disturbare
    calcHistIdx = Math.min(calcHistory.length - 1, calcHistIdx + 1);
  } else {
    if (calcHistIdx < 0) return;
    calcHistIdx -= 1;
  }
  e.preventDefault();
  calcExpr.value = calcHistIdx >= 0 ? calcHistory[calcHistIdx] : "";
});

function addCell(op, expr, res, fromAI, record, index) {
  if (record !== false) { cellData.push({ op, expr, res, ai: !!fromAI }); index = cellData.length - 1; saveState(); }
  const n = (Number.isInteger(index) ? index : Math.max(0, cellData.length - 1)) + 1;
  const dataObj = record !== false ? cellData[cellData.length - 1] : (Number.isInteger(index) ? cellData[index] : null);

  const cell = document.createElement("div");
  cell.className = "cell" + (fromAI ? " cell-ai" : "");

  const rail = document.createElement("div"); rail.className = "cell-rail";
  const num = document.createElement("span"); num.className = "cell-n"; num.textContent = String(n).padStart(2, "0");
  rail.appendChild(num);

  const body = document.createElement("div"); body.className = "cell-body";
  const head = document.createElement("div"); head.className = "cell-head";
  const label = document.createElement("span"); label.className = "cell-label";
  if (fromAI) { const tag = document.createElement("span"); tag.className = "cell-tag"; tag.textContent = "IA"; label.appendChild(tag); }
  const opName = document.createElement("b"); opName.className = "cell-op"; opName.textContent = OP_LABEL[op] || op;
  const exprEl = document.createElement("code"); exprEl.className = "cell-expr"; exprEl.textContent = expr || "";
  exprEl.title = "Clicca per riusare questa espressione nel calcolo";
  exprEl.addEventListener("click", () => {
    calcExpr.value = expr || "";
    if ([...calcOp.options].some((o) => o.value === op)) calcOp.value = op;
    updateExtra();
    calcExpr.focus();
    calcExpr.setSelectionRange(calcExpr.value.length, calcExpr.value.length);
  });
  label.append(opName, exprEl);
  head.appendChild(label);
  if (res && !res.error && res.result) {
    const btn = document.createElement("button");
    btn.type = "button"; btn.className = "cell-explain"; btn.textContent = "Spiega";
    btn.title = "Spiegazione dei passaggi qui nella voce";
    btn.addEventListener("click", () => toggleExplain(cell, dataObj));
    head.appendChild(btn);
  }

  const out = document.createElement("div"); out.className = "cell-out";
  if (res && res.error) { out.classList.add("cell-err"); out.textContent = "Errore: " + res.error; }
  else {
    const latex = res && res.latex != null ? res.latex : (res && res.result);
    const items = Array.isArray(latex) ? latex : [latex];
    out.textContent = items.filter((x) => x != null).map((l) => "$$" + String(l) + "$$").join(" ");
    renderMathInto(out);
  }
  body.append(head, out);

  // referto dello studio di funzione: sezioni richiudibili sotto la voce
  if (res && !res.error && res.kind === "studio" && Array.isArray(res.sections) && res.sections.length) {
    const rep = document.createElement("div"); rep.className = "cell-report";
    for (const s of res.sections) {
      const det = document.createElement("details");
      const sum = document.createElement("summary"); sum.textContent = String(s.label || "");
      const txt = document.createElement("div"); txt.className = "report-text"; txt.textContent = String(s.text || "");
      det.append(sum, txt);
      rep.appendChild(det);
    }
    body.appendChild(rep);
  }

  if (res && !res.error && res.result) {
    const plain = Array.isArray(res.result) ? res.result.join(", ") : String(res.result);
    const raw = document.createElement("div"); raw.className = "cell-raw";
    raw.textContent = Array.isArray(res.result) ? res.result.join("  ·  ") : res.result;
    raw.title = "Clicca per copiare il risultato";
    raw.addEventListener("click", () => copyText(plain, "risultato copiato"));
    body.appendChild(raw);
    const bar = document.createElement("div"); bar.className = "cell-actions";
    bar.append(
      mkBtn("→ calcolo", () => { setMode("algebra"); calcExpr.value = plain; calcExpr.focus(); }),
      mkBtn("→ chat", () => { inputEl.value = (inputEl.value.trim() ? inputEl.value.replace(/\s+$/, "") + "\n" : "") + plain; inputEl.focus(); })
    );
    if (res.kind === "studio" && res.draw) {
      bar.append(mkBtn("📈 Disegna", () => drawStudioCell(res)));
    }
    if (res.kind === "vettori" && res.draw) {
      const sel = document.createElement("select");
      sel.className = "draw-dim";
      sel.title = "Dove disegnare i vettori: piano o spazio";
      sel.innerHTML = (res.draw.dimension === 3 ? "" : '<option value="2d">2D</option>') + '<option value="3d">3D</option>';
      bar.append(sel, mkBtn("📈 Disegna", () => drawVectorsCell(res, sel.value)));
    }
    body.appendChild(bar);
  }

  cell.append(rail, body);
  calcCells.prepend(cell);
  refreshCalcEmpty();
  return cell;
}

// ---------- disegno dei referti: lo studio di funzione e i vettori ----------
// Crea la figura sulla lavagna (sostituisce quella presente) e inquadra il risultato.
async function runCustomConstruction(cmds, three, fitOpts) {
  const generation = conversationGeneration;
  let okN = 0;
  await enqueueGgbWork(generation, async () => {
    if (generation !== conversationGeneration) return false;
    setView3d(!!three, generation);
    try { ggbApplet.newConstruction(); applyGgbTheme(); } catch {}
    pushUndoPoint();
    const results = await applyCommands(cmds, generation);
    if (generation !== conversationGeneration) return false;
    okN = results.filter((r) => r.ok).length;
    if (!three && fitOpts) fitToContent(fitOpts);
    pushUndoPoint();
    return true;
  });
  if (generation !== conversationGeneration) return okN;
  saveState();
  if (okN < cmds.length) flash("disegno eseguito in parte (" + okN + "/" + cmds.length + " comandi)");
  return okN;
}

const STUDIO_POINT_COLORS = { zero: "220,38,38", "asse y": "37,99,235", massimo: "22,163,74", minimo: "22,163,74", "punto stazionario": "217,119,6", flesso: "124,58,237", dato: "37,99,235", complesso: "124,58,237", coniugato: "148,163,184", somma_parziale: "22,163,74", soluzione: "220,38,38" };
const SEGMENT_COLORS = { complesso: "124,58,237", coniugato: "148,163,184" };

function drawStudioCell(res) {
  const d = res && res.draw;
  if (!d) return;
  const cmds = [];
  const used = new Set();
  const fit = { functions: [], points: [] };
  if (d.funzione) {
    cmds.push("f(x)=" + d.funzione);
    used.add("f");
    fit.functions.push("f");
  }
  for (const f of (d.funzioni || []).slice(0, 6)) {
    const nm = String((f && f.nome) || "").replace(/[^A-Za-z0-9_]/g, "") || ("f" + (fit.functions.length + 1));
    if (!f || !f.espressione || used.has(nm)) continue;
    used.add(nm);
    cmds.push(nm + "(x)=" + f.espressione);
    fit.functions.push(nm);
  }
  for (const p of (d.punti || []).slice(0, 40)) {
    const nm = String(p.nome || "").replace(/[^A-Za-z0-9_]/g, "");
    const x = Number(p.x), y = Number(p.y);
    if (!nm || used.has(nm) || !Number.isFinite(x) || !Number.isFinite(y)) continue;
    used.add(nm);
    cmds.push(nm + "=(" + fmtViewNum(x) + "," + fmtViewNum(y) + ")");
    cmds.push("SetColor(" + nm + "," + (STUDIO_POINT_COLORS[p.tipo] || "100,116,139") + ")");
    cmds.push("SetPointSize(" + nm + ",5)");
    fit.points.push({ x, y });
  }
  let si = 0;
  for (const s of (d.segmenti || []).slice(0, 12)) {
    const da = s && Array.isArray(s.da) ? s.da.map(Number) : null;
    const a = s && Array.isArray(s.a) ? s.a.map(Number) : null;
    if (!da || !a || ![da[0], da[1], a[0], a[1]].every(Number.isFinite)) continue;
    si++;
    const nm = "seg" + si;
    cmds.push(nm + "=Segment((" + fmtViewNum(da[0]) + "," + fmtViewNum(da[1]) + "),(" + fmtViewNum(a[0]) + "," + fmtViewNum(a[1]) + "))");
    cmds.push("SetColor(" + nm + "," + (SEGMENT_COLORS[s.tipo] || "124,58,237") + ")");
    cmds.push("SetLineThickness(" + nm + ",2)");
    fit.points.push({ x: da[0], y: da[1] }, { x: a[0], y: a[1] });
  }
  let li = 0;
  for (const l of (d.linee || []).slice(0, 8)) {
    const s = String(l || "").trim();
    if (!/^(x|y)\s*=/.test(s)) continue;
    li++;
    const nm = "asint" + li;
    if (used.has(nm)) continue;
    used.add(nm);
    cmds.push(nm + ": " + s);
    cmds.push("SetColor(" + nm + ",148,163,184)");
    cmds.push("SetLineStyle(" + nm + ",1)");
  }
  if (!cmds.length) return;
  const fitOpts = (fit.functions.length || fit.points.length) ? { functions: fit.functions, points: fit.points } : null;
  runCustomConstruction(cmds, false, fitOpts);
}

const VECTOR_COLORS = ["37,99,235", "220,38,38", "22,163,74", "124,58,237", "234,88,12", "13,148,136"];

function drawVectorsCell(res, mode) {
  const d = res && res.draw;
  if (!d || !Array.isArray(d.vettori) || !d.vettori.length) return;
  const three = mode === "3d";
  if (!three && d.dimension === 3) { flash("questi vettori sono nello spazio: scegli la vista 3D"); return; }
  const cmds = [];
  const used = new Set();
  const fitPts = three ? null : [{ x: 0, y: 0 }];
  d.vettori.slice(0, 8).forEach((v, i) => {
    let nm = String(v.label || ("v" + (i + 1))).replace(/[^A-Za-z0-9_]/g, "");
    if (!nm || used.has(nm)) nm = "v" + (i + 1) + (used.has("v" + (i + 1)) ? "_" + i : "");
    used.add(nm);
    const comps = (v.components || []).map(Number).filter((n) => Number.isFinite(n));
    if (comps.length !== 2 && comps.length !== 3) return;
    const c3 = comps.length === 2 ? [comps[0], comps[1], 0] : comps;
    if (three) cmds.push(nm + "=Vector((0,0,0),(" + c3.map(fmtViewNum).join(",") + "))");
    else {
      cmds.push(nm + "=Vector((0,0),(" + comps.map(fmtViewNum).join(",") + "))");
      if (fitPts) fitPts.push({ x: comps[0], y: comps[1] });
    }
    cmds.push("SetColor(" + nm + "," + VECTOR_COLORS[i % VECTOR_COLORS.length] + ")");
    cmds.push("SetLineThickness(" + nm + ",4)");
  });
  if (!cmds.length) return;
  runCustomConstruction(cmds, three, fitPts ? { points: fitPts } : null);
}

// ---------- strumenti rapidi sulla lavagna: area e tangente ----------
// AGGIUNGONO alla lavagna corrente (non azzerano il disegno).
async function addToBoard(cmds, fitOpts) {
  const generation = conversationGeneration;
  let results = [];
  await enqueueGgbWork(generation, async () => {
    if (generation !== conversationGeneration) return false;
    pushUndoPoint();
    results = await applyCommands(cmds, generation);
    if (generation !== conversationGeneration) return false;
    if (fitOpts) fitToContent(fitOpts);
    pushUndoPoint();
    return true;
  });
  if (generation !== conversationGeneration) return results;
  saveState();
  const bad = results.filter((r) => !r.ok);
  if (bad.length) flash("strumento: " + bad.length + " comandi non riusciti su " + results.length);
  return results;
}

function ftFnText() {
  const raw = $("#ftFn").value.trim();
  if (!raw) return "";
  const m = raw.match(/^[A-Za-z]\w*\s*\(x\)\s*=\s*(.+)$/); // "f(x)=..." → solo il secondo membro
  return (m ? m[1] : raw);
}

function ftNumber(sel) {
  const raw = String($(sel).value || "").trim().replace(",", ".");
  if (!raw) return null;      // manca
  const v = Number(raw);
  return Number.isFinite(v) ? v : NaN; // NaN = scritto male
}

function fmt6(v) { return String(Number(Number(v).toFixed(6))); }

function ftCheck() {
  const fn = ftFnText();
  if (!fn) { flash("scrivi prima la funzione (es. x^2-1)"); return null; }
  return fn;
}

$("#ftArea").addEventListener("click", async () => {
  const fn = ftCheck(); if (!fn) return;
  const a = ftNumber("#ftA"), b = ftNumber("#ftB");
  if (a === null || b === null) { flash("indica gli estremi «da» e «a» dell'area"); return; }
  if (Number.isNaN(a) || Number.isNaN(b)) { flash("gli estremi devono essere numeri"); return; }
  if (a === b) { flash("gli estremi coincidono: l'area sarebbe zero"); return; }
  const results = await addToBoard([
    "f(x)=" + fn,
    "Area=Integral(f, " + fmtViewNum(a) + ", " + fmtViewNum(b) + ")",
    "SetColor(Area, 37,99,235)",
    "SetFilling(Area, 0.35)",
  ]);
  if (results.length && results.every((r) => r.ok)) {
    let val = null;
    try { val = Number(ggbApplet.getValue("Area")); } catch {}
    if (Number.isFinite(val)) flash("area = " + fmt6(val));
    else flash("area disegnata sulla lavagna");
  }
});

$("#ftTangent").addEventListener("click", async () => {
  const fn = ftCheck(); if (!fn) return;
  const x0 = ftNumber("#ftX0");
  if (x0 === null) { flash("indica il punto «x₀» della tangente"); return; }
  if (Number.isNaN(x0)) { flash("il punto deve essere un numero"); return; }
  const px = fmtViewNum(x0);
  const results = await addToBoard([
    "f(x)=" + fn,
    "P0=(" + px + ", f(" + px + "))",
    "tang=Tangent(P0, f)",
    "SetColor(P0, 220,38,38)",
    "SetPointSize(P0,5)",
    "SetColor(tang, 220,38,38)",
  ]);
  if (results.length && results.every((r) => r.ok)) flash("tangente disegnata in x = " + px);
});

$("#ftTangentAnim").addEventListener("click", async () => {
  const fn = ftCheck(); if (!fn) return;
  const cur = viewFromBoard();
  const xmin = cur ? cur.xmin : -5, xmax = cur ? cur.xmax : 5;
  const step = Math.max((xmax - xmin) / 100, 0.01);
  const results = await addToBoard([
    "f(x)=" + fn,
    "t=Slider(" + fmtViewNum(xmin) + ", " + fmtViewNum(xmax) + ", " + fmtViewNum(step) + ", 1, 100, false, true, true, false)",
    "Pt=(t, f(t))",
    "SetColor(Pt, 220,38,38)",
    "SetPointSize(Pt,5)",
    "tanA=Tangent(Pt, f)",
    "SetColor(tanA, 220,38,38)",
  ]);
  if (results.length && results.every((r) => r.ok)) {
    try { ggbApplet.startAnimation(); } catch {}
    flash("tangente animata: il punto scorre col cursore t");
  }
});

// contatore del quaderno + stato vuoto con esempi da provare
const calcEmpty = $("#calcEmpty");
function refreshCalcEmpty() {
  const n = cellData.length;
  if (calcEmpty) calcEmpty.hidden = n > 0;
  const counter = $("#calcCount");
  if (counter) counter.textContent = n === 0 ? "nessun calcolo" : n === 1 ? "1 calcolo" : n + " calcoli";
}
if (calcEmpty) {
  calcEmpty.addEventListener("click", (e) => {
    const chip = e.target.closest("button[data-expr]");
    if (!chip) return;
    calcExpr.value = chip.dataset.expr || "";
    calcOp.value = chip.dataset.op || "simplify";
    updateExtra();
    if (chip.dataset.point != null) $("#calcB").value = chip.dataset.point;
    calcForm.requestSubmit();
  });
}

// ---------- spiegazione inline della voce ("Spiega") ----------
// Un solo modo di spiegare: parole semplici alternate all'algebra.
function explainResultText(res) {
  if (!res) return "";
  if (res.kind === "studio" && Array.isArray(res.sections)) {
    return res.sections.map((s) => (s.label || "") + ": " + (s.text || "")).join("\n");
  }
  return Array.isArray(res.result) ? res.result.join(", ") : String(res.result || "");
}
function explainResultLatex(res) {
  if (!res) return "";
  const l = res.latex != null ? res.latex : res.result;
  return Array.isArray(l) ? l.join(", ") : String(l || "");
}

function buildExplainBox(cellEl, dataObj, initial) {
  const box = document.createElement("div");
  box.className = "cell-explain-box";
  const head = document.createElement("div"); head.className = "explain-head";
  const title = document.createElement("span"); title.className = "explain-title"; title.textContent = "Spiegazione";
  const close = document.createElement("button");
  close.type = "button"; close.className = "explain-close"; close.textContent = "✕"; close.title = "Chiudi la spiegazione";
  close.addEventListener("click", () => {
    if (box._abort) { try { box._abort.abort(); } catch {} }
    box.remove();
  });
  head.append(title, close);
  const body = document.createElement("div"); body.className = "explain-body";
  box.append(head, body);
  box._body = body;
  cellEl.querySelector(".cell-body").appendChild(box);
  if (initial && initial.text) renderMD(body, initial.text);
  box.scrollIntoView({ block: "nearest", behavior: "smooth" });
  return box;
}

function toggleExplain(cellEl, dataObj) {
  const existing = cellEl.querySelector(".cell-explain-box");
  if (existing) {
    if (existing._abort) { try { existing._abort.abort(); } catch {} }
    existing.remove();
    return;
  }
  const box = buildExplainBox(cellEl, dataObj, null);
  runExplain(box, dataObj);
}

async function runExplain(box, dataObj) {
  if (!box || !dataObj) return;
  if (box._abort) { try { box._abort.abort(); } catch {} }
  const abort = new AbortController();
  box._abort = abort;
  const body = box._body;
  body.textContent = "";
  const loading = document.createElement("span");
  loading.className = "explain-loading";
  loading.textContent = "sto spiegando…";
  body.appendChild(loading);

  let acc = "", lastRender = 0, queued = false, timedOut = false;
  const hardStop = setTimeout(() => { timedOut = true; try { abort.abort(); } catch {} }, 150000);
  const render = () => {
    queued = false; lastRender = Date.now();
    if (box.isConnected) renderMD(body, acc);
  };
  try {
    const res = await fetch("/api/explain", {
      method: "POST", headers: { "Content-Type": "application/json" },
      signal: abort.signal,
      body: JSON.stringify({
        op: dataObj.op, expr: dataObj.expr,
        result: explainResultText(dataObj.res), latex: explainResultLatex(dataObj.res),
        model: currentModel,
      }),
    });
    if (!res.ok) throw new Error("HTTP " + res.status + ": " + (await res.text()).slice(0, 200));
    const reader = res.body.getReader();
    const dec = new TextDecoder();
    let buf = "";
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!box.isConnected) { try { await reader.cancel(); } catch {} break; }
      buf += dec.decode(value, { stream: true });
      let i;
      while ((i = buf.indexOf("\n\n")) >= 0) {
        const block = buf.slice(0, i); buf = buf.slice(i + 2);
        const ev = (block.match(/^event:\s*(.*)$/m) || [])[1] || "";
        const dataLine = (block.match(/^data:\s*(.*)$/m) || [])[1] || "{}";
        let data = {}; try { data = JSON.parse(dataLine); } catch {}
        if (ev === "delta") {
          acc += data.text || "";
          if (!queued && Date.now() - lastRender > 120) { queued = true; requestAnimationFrame(render); }
        } else if (ev === "error") {
          acc += (acc ? "\n\n" : "") + "**Errore:** " + (data.message || "spiegazione non riuscita");
        }
      }
    }
  } catch (e) {
    if (e && e.name === "AbortError") {
      if (!box.isConnected || !timedOut) return;
      acc = acc || "**Errore:** la spiegazione sta impiegando troppo: riprova.";
    } else {
      acc = acc || ("**Errore:** " + String(e.message || e));
    }
  } finally {
    clearTimeout(hardStop);
  }
  if (!box.isConnected) return;
  if (!acc.trim()) acc = "_La spiegazione non è arrivata: riprova._";
  renderMD(body, acc);
  dataObj.spiega = { text: acc.slice(0, 6000) };
  saveState();
}

calcOp.addEventListener("change", updateExtra);
calcForm.addEventListener("submit", async (e) => {
  e.preventDefault();
  const expr = calcExpr.value.trim();
  if (!expr) return;
  const op = calcOp.value;
  const args = { operation: op, expr };
  const v = $("#calcVar").value.trim(); if (v) args.var = v;
  if (op === "integrate") { const a = $("#calcA").value.trim(), b = $("#calcB").value.trim(); if (a) args.lower = a; if (b) args.upper = b; }
  if (op === "limit") { const p = $("#calcB").value.trim(); if (p) args.point = p; }
  if (op === "diff" || op === "series" || op === "parziali") { const o = $("#calcOrder").value.trim(); if (o) args.order = o; }
  if (VECTOR_OPS.has(op)) args.vectors = expr;
  rememberCalc(expr);
  $("#calcGo").disabled = true;
  try {
    const r = await fetch("/api/compute", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(args) });
    addCell(op, expr, await r.json());
    calcExpr.value = "";
  } catch (err) { addCell(op, expr, { error: String(err.message || err) }); }
  $("#calcGo").disabled = false;
  calcExpr.focus();
});

// ---------- cronologia ----------
const drawer = $("#historyDrawer");
function fmtDate(ms) {
  return new Date(ms).toLocaleString("it-IT", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" });
}
function appendRendered(role, content, files, idx) {
  let d;
  if (role === "user") {
    d = makeUserBubble(content, (files || []).map((n) => ({ name: n })));
  } else {
    d = addMsg(role);
    const b = document.createElement("div");
    d.appendChild(b);
    renderMD(b, content);
    if (files && files.length) d.appendChild(attachListEl(files));
  }
  if (idx != null) d.dataset.idx = idx;
  return d;
}
async function refreshHistory() {
  const list = $("#historyList");
  const q = ($("#historySearch") ? $("#historySearch").value : "") || "";
  try {
    const j = await (await fetch("/api/history" + (q.trim() ? "?q=" + encodeURIComponent(q.trim()) : ""))).json();
    if (!j.items.length) {
      list.innerHTML = "";
      const d = document.createElement("div"); d.className = "hist-empty";
      d.textContent = q.trim()
        ? "Nessun risultato. Prova con meno parole, oppure un #tag."
        : "Nessun argomento ancora. Le conversazioni compaiono qui.";
      list.appendChild(d);
      return;
    }
    list.innerHTML = "";
    for (const it of j.items) {
      const row = document.createElement("div"); row.className = "hist-item";
      const t = document.createElement("div"); t.className = "t";
      const b = document.createElement("b"); b.textContent = it.title || "Senza titolo";
      const s = document.createElement("span");
      const extra = [];
      if (it.figures) extra.push(it.figures + (it.figures === 1 ? " figura" : " figure"));
      else if (it.hasGgb) extra.push("figura");
      if (it.cells) extra.push(it.cells + " calcoli");
      s.textContent = fmtDate(it.updatedAt) + " · " + it.count + " messaggi" + (extra.length ? " · " + extra.join(" · ") : "");
      t.append(b, s);
      if (it.match && it.match.snippet) {
        const m = document.createElement("div"); m.className = "hist-match";
        const w = document.createElement("em"); w.className = "hist-where";
        w.textContent = "trovato in " + (it.match.where || []).join(", ") + ": ";
        const sn = document.createElement("span"); sn.className = "hist-snip"; sn.textContent = it.match.snippet;
        m.append(w, sn);
        t.appendChild(m);
      }
      // etichette: chip cliccabili + aggiunta/rimozione inline
      const tagRow = document.createElement("div"); tagRow.className = "hist-tags";
      const addTag = (tag) => fetch("/api/conversation/tags", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: it.id, tag, action: "add" }),
      }).then(() => refreshHistory()).catch(() => {});
      const rmTag = (tag) => fetch("/api/conversation/tags", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: it.id, tag, action: "remove" }),
      }).then(() => refreshHistory()).catch(() => {});
      for (const tg of (it.tags || [])) {
        const chip = document.createElement("span"); chip.className = "hist-tag";
        const link = document.createElement("button"); link.type = "button"; link.className = "hist-tag-name"; link.textContent = "#" + tg;
        link.title = "Mostra solo gli argomenti con questa etichetta";
        link.addEventListener("click", (ev) => {
          ev.stopPropagation();
          const inp = $("#historySearch");
          inp.value = "#" + tg;
          refreshHistory();
        });
        const x = document.createElement("button"); x.type = "button"; x.className = "hist-tag-x"; x.textContent = "×";
        x.title = "Togli l'etichetta";
        x.addEventListener("click", (ev) => { ev.stopPropagation(); rmTag(tg); });
        chip.append(link, x);
        tagRow.appendChild(chip);
      }
      const addBtn = document.createElement("button");
      addBtn.type = "button"; addBtn.className = "hist-tag-add"; addBtn.textContent = "+ etichetta";
      addBtn.title = "Aggiungi un'etichetta a questo argomento";
      addBtn.addEventListener("click", (ev) => {
        ev.stopPropagation();
        const inp = document.createElement("input");
        inp.type = "text"; inp.className = "hist-tag-input"; inp.maxLength = 24; inp.placeholder = "etichetta…";
        inp.addEventListener("click", (e2) => e2.stopPropagation());
        inp.addEventListener("keydown", (e2) => {
          e2.stopPropagation();
          if (e2.key === "Enter") { const v = inp.value.trim(); if (v) addTag(v); else refreshHistory(); }
          else if (e2.key === "Escape") refreshHistory();
        });
        addBtn.replaceWith(inp);
        inp.focus();
      });
      tagRow.appendChild(addBtn);
      t.appendChild(tagRow);
      const del = document.createElement("button");
      del.type = "button"; del.className = "hist-del"; del.textContent = "Elimina";
      del.addEventListener("click", async (ev) => {
        ev.stopPropagation();
        await fetch("/api/conversation?id=" + encodeURIComponent(it.id), { method: "DELETE" });
        refreshHistory();
      });
      row.append(t, del);
      row.addEventListener("click", () => openConv(it.id));
      list.appendChild(row);
    }
  } catch { list.innerHTML = '<div class="hist-empty">Cronologia non disponibile.</div>'; }
}
async function openConv(id) {
  const generation = invalidateConversationWork();
  const pendingWrites = stateWriteQueue;
  conversationLoading = true;
  sendBtn.disabled = true;
  statusEl.textContent = "carico argomento…";
  try {
    await pendingWrites;
    if (generation !== conversationGeneration) return;
    const r = await fetch("/api/conversation?id=" + encodeURIComponent(id));
    if (generation !== conversationGeneration) return;
    if (!r.ok) { flash("argomento non disponibile"); return; }
    const c = await r.json();
    if (generation !== conversationGeneration || !(await renderConversation(c, generation))) return;
    drawer.hidden = true;
    statusEl.textContent = "argomento ripreso";
    setTimeout(() => (statusEl.textContent = ""), 1500);
  } catch { if (generation === conversationGeneration) flash("errore nel caricamento dell'argomento"); }
  finally {
    if (generation === conversationGeneration) {
      conversationLoading = false;
      sendBtn.disabled = false;
      saveState();
    }
  }
}
$("#historyBtn").addEventListener("click", () => { drawer.hidden = !drawer.hidden; if (!drawer.hidden) { refreshHistory(); refreshBackupInfo(); } });
$("#historyClose").addEventListener("click", () => { drawer.hidden = true; });

// ---------- copie di sicurezza ----------
async function refreshBackupInfo() {
  const el = $("#backupInfo");
  if (!el) return;
  try {
    const j = await (await fetch("/api/backup")).json();
    const last = (j.items || [])[0];
    el.textContent = last
      ? "ultimo: " + fmtDate(last.t) + " · " + Math.max(1, Math.round(last.size / 1024)) + " KB"
      : "nessun backup";
  } catch { el.textContent = ""; }
}
$("#backupBtn").addEventListener("click", async () => {
  const b = $("#backupBtn");
  b.disabled = true; const old = b.textContent; b.textContent = "💾 salvo…";
  try {
    const r = await (await fetch("/api/backup", { method: "POST" })).json();
    flash(r.ok ? "backup creato" : "backup non riuscito: " + (r.error || ""));
  } catch { flash("backup non riuscito"); }
  b.disabled = false; b.textContent = old;
  refreshBackupInfo();
});

// ---------- allegati ----------
const MAX_FILE = 8 * 1024 * 1024, MAX_FILES = 4;
let pending = [];

function fileIcon(a) {
  const mime = String(a.mime || ""), n = String(a.name || "");
  if (mime.startsWith("audio/") || /\.(mp3|wav|m4a|m4b|ogg|oga|opus|flac|webm|aac|wma)$/i.test(n)) return "🎵";
  if (mime.startsWith("image/")) return "🖼";
  if (mime.includes("pdf")) return "📕";
  return "📄";
}

function fmtSize(n) { return n >= 1048576 ? (n / 1048576).toFixed(1) + " MB" : Math.max(1, Math.round(n / 1024)) + " KB"; }

function readFile(file) {
  return new Promise((resolve) => {
    const fr = new FileReader();
    fr.onload = () => {
      const s = String(fr.result || "");
      resolve({ name: file.name, mime: file.type || "application/octet-stream", b64: s.slice(s.indexOf(",") + 1), size: file.size });
    };
    fr.onerror = () => resolve(null);
    fr.readAsDataURL(file);
  });
}

function renderChips() {
  const box = $("#attachChips");
  box.innerHTML = "";
  box.hidden = pending.length === 0;
  pending.forEach((a, i) => {
    const c = document.createElement("span"); c.className = "chip";
    const b = document.createElement("b"); b.textContent = fileIcon(a) + " " + a.name;
    const s = document.createElement("span"); s.textContent = fmtSize(a.size);
    const x = document.createElement("button"); x.type = "button"; x.textContent = "✕"; x.title = "Rimuovi";
    x.addEventListener("click", () => { pending.splice(i, 1); renderChips(); });
    c.append(b, s, x);
    box.appendChild(c);
  });
  // con una foto fra gli allegati: via rapida per farla risolvere passo passo
  if (pending.some((a) => String(a.mime || "").startsWith("image/"))) {
    const q = document.createElement("button");
    q.type = "button"; q.className = "chip-quick"; q.id = "photoQuick";
    q.textContent = "📷 Risolvi l'esercizio";
    q.title = "Riempie la richiesta: il tutor legge la foto e risolve passo passo";
    q.addEventListener("click", () => {
      if (!inputEl.value.trim()) inputEl.value = "Risolvi l'esercizio nell'immagine: spiegami tutti i passaggi.";
      inputEl.focus();
    });
    box.appendChild(q);
  }
}

function flash(msg) { statusEl.textContent = msg; setTimeout(() => (statusEl.textContent = ""), 2500); }

async function addFiles(list) {
  for (const f of Array.from(list || [])) {
    if (pending.length >= MAX_FILES) { flash("massimo " + MAX_FILES + " allegati"); break; }
    if (f.size > MAX_FILE) { flash("«" + f.name + "» troppo grande (max 4 MB)"); continue; }
    const a = await readFile(f);
    if (a) pending.push(a);
  }
  renderChips();
}

function attachListEl(names) {
  const list = document.createElement("div"); list.className = "attach-list";
  for (const n of names) { const s = document.createElement("span"); s.className = "chip-static"; s.textContent = n; list.appendChild(s); }
  return list;
}

// ---------- persistenza della sessione ----------
let saveTimer = null;
let stateWriteQueue = Promise.resolve();
function snapshot() {
  let ggb = null;
  if (ggbReady) {
    try { if (ggbApplet.getAllObjectNames().length) ggb = ggbApplet.getBase64(); } catch {}
  }
  const storedRevision = (() => { try { return Number(localStorage.getItem("mathapp.stateRevision")) || 0; } catch { return 0; } })();
  stateRevision = Math.max(Date.now(), stateRevision + 1, storedRevision + 1);
  try { localStorage.setItem("mathapp.stateRevision", String(stateRevision)); } catch {}
  return { id: conversationId, revision: stateRevision, ggb, cells: cellData, mode, figures, view3d: ggb3d, view: viewCustom };
}
function writeState(state) {
  const write = stateWriteQueue.catch(() => {}).then(() =>
    fetch("/api/conversation/state", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(state) }).catch(() => {})
  );
  stateWriteQueue = write;
  return write;
}
function saveState() {
  if (booting || conversationLoading) return;
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    saveTimer = null;
    const s = snapshot();
    writeState(s);
  }, 600);
}

function persistStateNow() {
  if (booting) return;
  clearTimeout(saveTimer);
  saveTimer = null;
  try {
    const s = snapshot(); // cattura qui l'id della chat corrente, prima di cambiarla
    return writeState(s);
  } catch {}
  return stateWriteQueue;
}

function invalidateConversationWork() {
  const generation = ++conversationGeneration;
  const wasLoading = conversationLoading;
  const controller = currentAbort;
  currentAbort = null;
  if (controller) { try { controller.abort(); } catch {} }
  streaming = false;
  conversationLoading = false;
  clearTimeout(saveTimer);
  saveTimer = null;
  setSendStop(false);
  statusEl.textContent = "";
  pendingSources = null;
  if (!wasLoading) persistStateNow();
  return generation;
}

async function renderConversation(conv, generation) {
  if (!conv || !conv.id || generation !== conversationGeneration) return false;
  ttsStop();
  if (Number.isSafeInteger(conv.stateRevision)) stateRevision = Math.max(stateRevision, conv.stateRevision);
  conversationId = String(conv.id);
  sessionId = conversationId;
  try {
    localStorage.setItem("mathapp.conv", conversationId);
    localStorage.removeItem("mathapp.empty");
  } catch {}

  messages = (Array.isArray(conv.messages) ? conv.messages : [])
    .filter((m) => m && (m.role === "user" || m.role === "assistant"))
    .map((m) => Object.assign({ role: m.role, content: m.content }, m.files && m.files.length ? { files: m.files } : {}));
  chatEl.replaceChildren();
  for (let i = 0; i < messages.length; i++) {
    try {
      const el = appendRendered(messages[i].role, messages[i].content, messages[i].files, i);
      if (messages[i].role === "assistant") addMsgActions(el, i); // copia · ascolta · ripasso anche a chat riaperte
    } catch (e) { console.warn("[MathApp] messaggio non ripristinato", e); }
  }

  cellData = Array.isArray(conv.cells) ? conv.cells.slice(-200) : [];
  calcCells.replaceChildren();
  for (let i = 0; i < cellData.length; i++) {
    try {
      const cellEl = addCell(cellData[i].op, cellData[i].expr, cellData[i].res, cellData[i].ai, false, i);
      if (cellEl && cellData[i].spiega && cellData[i].spiega.text) buildExplainBox(cellEl, cellData[i], cellData[i].spiega);
    } catch (e) { console.warn("[MathApp] cella non ripristinata", e); }
  }
  refreshCalcEmpty();
  calcHistory = cellData.slice().reverse().map((c) => c.expr).filter(Boolean).slice(0, 20);
  calcHistIdx = -1;

  figures = (Array.isArray(conv.figures) ? conv.figures : [])
    .filter((f) => f && f.fid != null)
    .slice(-60)
    .map((f) => ({
      fid: String(f.fid),
      title: String(f.title || "Figura"),
      commands: Array.isArray(f.commands) ? f.commands.slice(0, 200).map(String) : [],
      msgIdx: Number.isInteger(f.msgIdx) ? f.msgIdx : null,
      view: f.view === "3d" ? "3d" : "2d",
    }));
  figSeq = figures.length;
  for (const f of figures) {
    try {
      const host = f.msgIdx != null ? chatEl.querySelector('[data-idx="' + f.msgIdx + '"]') : null;
      renderFigureCard(host || chatEl, f, { collapsed: true });
    } catch (e) { console.warn("[MathApp] costruzione non ripristinata", e); }
  }
  refreshFigureList();
  pending = [];
  renderChips();
  pendingSources = null;
  usageTot = { prompt: 0, completion: 0, total: 0 };
  if ($("#usage")) $("#usage").textContent = "";

  try {
    const boardReady = await enqueueGgbWork(generation, async () => {
      if (generation !== conversationGeneration) return false;
      let restored = false;
      if (typeof conv.ggb === "string" && conv.ggb) {
        restored = await setGgbBase64Async(conv.ggb);
        if (generation !== conversationGeneration) return false;
        if (restored) applyGgbTheme();
      }
      if (!restored) {
        try { ggbApplet.newConstruction(); applyGgbTheme(); } catch {}
      }
      let nObj = 0;
      try { nObj = ggbApplet.getAllObjectNames().length; } catch {}
      if (!restored || !nObj) {
        const last = figures[figures.length - 1];
        if (last) {
          if (restored) ggbApplet.newConstruction();
          await applyCommands(last.commands, generation);
          if (generation !== conversationGeneration) return false;
          console.info("[MathApp] figura ricostruita da:", last.title);
        }
      }
      // orientamento 3D accumulato da un trascinamento impazzito: torna allo standard
      try {
        const m = ggbApplet.getXML().match(/<coordSystem[^>]*xAngle="([^"]+)" zAngle="([^"]+)"/);
        if (m && Math.abs(parseFloat(m[2])) > 3600) setView3dAngles(VIEW3D_STD);
      } catch {}
      return generation === conversationGeneration;
    });
    if (!boardReady || generation !== conversationGeneration) return false;
  } catch (e) { console.warn("[MathApp] ripristino figura", e); }

  if (generation !== conversationGeneration) return false;
  setView3d(conv.view3d === true, generation); // ripristina la vista 3D se era attiva
  viewCustom = null;
  viewCache = null;
  if (conv.view && typeof conv.view === "object") {
    const rec = { xmin: Number(conv.view.xmin), xmax: Number(conv.view.xmax), ymin: Number(conv.view.ymin), ymax: Number(conv.view.ymax), axes: conv.view.axes !== false, grid: conv.view.grid === true };
    if (viewFinite(rec)) {
      viewCustom = rec;
      if (!ggb3d) applyViewToBoard(rec);
    }
  }
  viewPanelSync();
  setMode(conv.mode === "algebra" ? "algebra" : "figure", true);
  if (generation !== conversationGeneration) return false;
  autoFollow = true;
  stick(true);
  return true;
}

window.addEventListener("beforeunload", () => {
  if (booting) return;
  try {
    const s = snapshot();
    navigator.sendBeacon("/api/conversation/state", new Blob([JSON.stringify(s)], { type: "application/json" }));
  } catch {}
});

async function restoreSession() {
  const generation = conversationGeneration;
  const stored = (() => { try { return localStorage.getItem("mathapp.conv"); } catch { return null; } })();
  let conv = null;
  if (stored) {
    try {
      const r = await fetch("/api/conversation?id=" + encodeURIComponent(stored));
      if (generation !== conversationGeneration) return;
      if (r.ok) conv = await r.json();
      else console.warn("[MathApp] sessione salvata non trovata:", stored);
    } catch (e) { console.warn("[MathApp] lettura sessione fallita", e); }
  }
  if (generation !== conversationGeneration) return;
  if (!conv && stored && (() => { try { return localStorage.getItem("mathapp.empty") !== "1"; } catch { return true; } })()) {
    // rete di sicurezza: la sessione salvata non esiste piu' -> recupero la piu' recente
    try {
      const h = await (await fetch("/api/history")).json();
      if (generation !== conversationGeneration) return;
      if (h.items && h.items.length) {
        const r2 = await fetch("/api/conversation?id=" + encodeURIComponent(h.items[0].id));
        if (generation !== conversationGeneration) return;
        if (r2.ok) { conv = await r2.json(); flash("ripristinata la sessione più recente"); }
      }
    } catch (e) { console.warn("[MathApp] recupero sessione recente fallito", e); }
  }
  if (!conv) { try { localStorage.removeItem("mathapp.conv"); } catch {} return; }
  if (generation !== conversationGeneration || !(await renderConversation(conv, generation))) return;
  const n = messages.length + cellData.length + figures.length;
  if (n) flash("sessione ripristinata (" + n + " elementi)");
}

// ---------- UI ----------
$("#composer").addEventListener("submit", (e) => {
  e.preventDefault();
  if (streaming) { flash("attendi la risposta in corso… oppure interrompila con «Ferma»."); return; }
  const t = inputEl.value.trim();
  if (!t) return;
  inputEl.value = "";
  send(t);
});
inputEl.addEventListener("keydown", (e) => {
  if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); $("#composer").requestSubmit(); }
});
$("#toggleGgb").addEventListener("click", (e) => {
  mainEl.classList.toggle("ggb-hidden");
  e.target.textContent = mainEl.classList.contains("ggb-hidden") ? "Mostra figura" : "Nascondi figura";
});
$("#modeFigure").addEventListener("click", () => setMode("figure"));
$("#modeAlgebra").addEventListener("click", () => setMode("algebra"));
// allegati: pulsante, selezione, trascinamento, incolla
$("#attachBtn").addEventListener("click", () => $("#fileInput").click());
$("#fileInput").addEventListener("change", (e) => { addFiles(e.target.files); e.target.value = ""; });
inputEl.addEventListener("paste", (e) => {
  const fs = e.clipboardData && e.clipboardData.files;
  if (fs && fs.length) { e.preventDefault(); addFiles(fs); }
});
(() => {
  const panel = $("#chatpanel");
  panel.addEventListener("dragover", (e) => { e.preventDefault(); panel.classList.add("drop-target"); });
  panel.addEventListener("dragleave", () => panel.classList.remove("drop-target"));
  panel.addEventListener("drop", (e) => {
    e.preventDefault(); panel.classList.remove("drop-target");
    if (e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files.length) addFiles(e.dataTransfer.files);
  });
})();
// divider trascinabile per ridimensionare figura e chat
(() => {
  const divider = $("#divider"), wrap = $("#ggbwrap");
  let dragging = false;
  divider.addEventListener("mousedown", () => { dragging = true; document.body.style.userSelect = "none"; });
  window.addEventListener("mousemove", (e) => {
    if (!dragging) return;
    const rect = mainEl.getBoundingClientRect();
    let pct = ((e.clientX - rect.left) / rect.width) * 100;
    pct = Math.max(20, Math.min(85, pct));
    wrap.style.flexBasis = pct + "%";
  });
  window.addEventListener("mouseup", () => { dragging = false; document.body.style.userSelect = ""; });
})();
$("#newChat").addEventListener("click", () => {
  const generation = invalidateConversationWork();
  ttsStop();
  messages = []; sessionId = crypto.randomUUID(); conversationId = crypto.randomUUID();
  chatEl.replaceChildren(); calcCells.replaceChildren(); cellData = [];
  refreshCalcEmpty();
  figures = []; figSeq = 0; refreshFigureList(); // BUG FIX: le costruzioni non si trascinano nella nuova chat
  try { localStorage.setItem("mathapp.conv", conversationId); localStorage.setItem("mathapp.empty", "1"); } catch {}
  pending = []; renderChips();
  usageTot = { prompt: 0, completion: 0, total: 0 };
  if ($("#usage")) $("#usage").textContent = "";
  queueGgbClear(generation);
  setView3d(false, generation);
  viewCustom = null;
  viewCache = null;
  setViewPanel(false);
  statusEl.textContent = "nuova chat";
  setTimeout(() => (statusEl.textContent = ""), 1200);
});

// ---------- strumenti di studio ----------
function mkBtn(label, fn, cls) {
  const b = document.createElement("button");
  b.type = "button"; b.textContent = label; if (cls) b.className = cls;
  b.addEventListener("click", fn);
  return b;
}

async function copyText(t, msg) {
  try { await navigator.clipboard.writeText(t || ""); flash(msg || "copiato"); }
  catch { flash("copia non disponibile"); }
}

// ---------- lettura ad alta voce (voce del browser, senza rete) ----------
let ttsBtn = null;
function ttsClean(t) {
  return String(t || "")
    .replace(/```[\s\S]*?```/g, " (blocco di codice) ")
    .replace(/\$\$[\s\S]*?\$\$/g, " formula ")
    .replace(/\$[^$\n]*\$/g, " formula ")
    .replace(/^#{1,6}\s*/gm, "")
    .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/[*_`>#]/g, "")
    .replace(/\s{2,}/g, " ")
    .trim();
}

function ttsStop() {
  try { if ("speechSynthesis" in window) speechSynthesis.cancel(); } catch {}
  if (ttsBtn) { ttsBtn.textContent = "🔊 Ascolta"; ttsBtn = null; }
}

function ttsSpeak(text, btn) {
  if (!("speechSynthesis" in window)) { flash("il browser non supporta la lettura ad alta voce"); return; }
  if (ttsBtn === btn) { ttsStop(); return; } // secondo clic: ferma
  ttsStop();
  const clean = ttsClean(text).slice(0, 12000);
  if (!clean) return;
  try {
    const u = new SpeechSynthesisUtterance(clean);
    u.lang = "it-IT";
    const voices = speechSynthesis.getVoices() || [];
    const it = voices.find((v) => /^it/i.test(v.lang || ""));
    if (it) { try { u.voice = it; } catch {} } // alcune voci strane non sono assegnabili: si legge con quella di sistema
    u.onend = () => { if (ttsBtn === btn) { btn.textContent = "🔊 Ascolta"; ttsBtn = null; } };
    speechSynthesis.speak(u);
    btn.textContent = "⏹ Ferma"; ttsBtn = btn;
  } catch { flash("lettura non disponibile"); }
}
window.ttsSpeak = ttsSpeak;

function stopStreaming() { if (currentAbort) { try { currentAbort.abort(); } catch {} } ttsStop(); }

// Il pulsante Invia diventa "Ferma" mentre l'IA risponde: un clic interrompe la risposta.
function setSendStop(on) {
  sendBtn.classList.toggle("is-stop", on);
  sendBtn.textContent = on ? "Ferma" : "Invia";
  if (on) sendBtn.title = "Interrompi la risposta (Esc)";
  else sendBtn.removeAttribute("title");
  sendBtn.disabled = false;
}

// ogni costruzione DEVE avere la sua scheda in chat: se manca, la riattacco
function ensureFigureCards() {
  for (const f of figures) {
    if (chatEl.querySelector('.ggb-card[data-fid="' + f.fid + '"]')) continue;
    const host = f.msgIdx != null ? chatEl.querySelector('[data-idx="' + f.msgIdx + '"]') : null;
    renderFigureCard(host || chatEl, f, { collapsed: true });
  }
}

async function regenerate() {
  if (streaming || conversationLoading) { flash("attendi il caricamento o la risposta in corso…"); return; }
  const last = messages[messages.length - 1];
  if (!last || last.role !== "assistant") { flash("niente da rigenerare"); return; }
  const idx = messages.length - 1;
  messages.pop();
  const el = chatEl.querySelector('.msg.assistant[data-idx="' + idx + '"]');
  if (el) el.remove();
  for (const f of figures) if (f.msgIdx === idx) f.msgIdx = null; // le schede verranno riattaccate
  autoFollow = true; stick(true);
  await runTurn();
}

// rivela lo svolgimento un blocco alla volta
function applySteps(bubble, body) {
  const blocks = [...body.children].filter((b) => !b.classList.contains("thinking"));
  if (blocks.length < 2) return;
  let shown = 1;
  const refresh = () => {
    blocks.forEach((b, i) => b.classList.toggle("step-hidden", i >= shown));
    count.textContent = "passo " + Math.min(shown, blocks.length) + " di " + blocks.length;
    if (shown >= blocks.length) next.disabled = true;
  };
  const ctl = document.createElement("div"); ctl.className = "step-ctl";
  const next = mkBtn("Passo successivo ▶", () => { shown = Math.min(blocks.length, shown + 1); refresh(); stick(); });
  const all = mkBtn("Mostra tutto", () => { shown = blocks.length; refresh(); stick(); });
  const count = document.createElement("span"); count.className = "step-count";
  ctl.append(next, all, count);
  bubble.appendChild(ctl);
  refresh();
}

// Le schede delle costruzioni vanno NEL paragrafo che le riguarda (la lettura geometrica),
// non in fondo alla risposta.
function placeFigureCards(bubble, body) {
  const cards = [...bubble.children].filter((el) => el.classList && el.classList.contains("ggb-card"));
  if (!cards.length) return;
  const blocks = [...body.children];
  const find = (re) => { for (let i = blocks.length - 1; i >= 0; i--) if (re.test(blocks[i].textContent || "")) return blocks[i]; return null; };
  const anchor = find(/geometric/i) || find(/(grafic|figura|disegn)/i);
  if (!anchor) return;
  let a = anchor;
  for (const c of cards) { a.after(c); a = c; }
}

function addMsgActions(bubble, idx) {
  if (bubble.querySelector(".msg-actions")) return;
  const bar = document.createElement("div"); bar.className = "msg-actions";
  bar.appendChild(mkBtn("⧉ Copia", () => copyText((messages[idx] || {}).content, "risposta copiata in Markdown")));
  if ((messages[idx] || {}).role === "assistant" && messages[idx].content) {
    const tts = mkBtn("🔊 Ascolta", (ev) => ttsSpeak(messages[idx].content, ev.currentTarget));
    tts.classList.add("tts-btn");
    bar.appendChild(tts);
  }
  if (idx === messages.length - 1) bar.appendChild(mkBtn("↻ Rigenera", () => regenerate()));
  const starBtn = mkBtn("★ Ripasso", async () => {
    const firstUser = (messages.find((m) => m.role === "user") || {}).content || "Argomento";
    starBtn.disabled = true;
    try {
      const r = await fetch("/api/review", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ convId: conversationId, title: firstUser, text: (messages[idx] || {}).content || "" }),
      });
      const j = await r.json().catch(() => ({}));
      starBtn.textContent = "★ Salvato";
      flash(j && j.existing ? "già nel Ripasso ★" : "aggiunto al Ripasso ★");
      if (!$("#reviewDrawer").hidden) refreshReview();
      refreshReviewBadge();
    } catch { starBtn.disabled = false; flash("non riuscito"); }
  });
  bar.appendChild(starBtn);
  starBtn.classList.add("review-btn");
  bubble.appendChild(bar);
}

// copia il LaTeX cliccando una formula in blocco
chatEl.addEventListener("click", (e) => {
  const k = e.target.closest(".katex-display");
  if (!k) return;
  const ann = k.querySelector('annotation[encoding="application/x-tex"]');
  if (ann && ann.textContent) copyText(ann.textContent, "formula LaTeX copiata");
});

// ---------- modalità didattiche (Esercitami / Passo-passo), si escludono a vicenda ----------
function applyTutorMode(mode) {
  tutorMode = mode === "socratic" ? "socratic" : null;
  stepMode = mode === "step";
  try {
    localStorage.setItem("mathapp.socratic", tutorMode ? "1" : "");
    localStorage.setItem("mathapp.step", stepMode ? "1" : "");
  } catch {}
  const sb = $("#socraticBtn"), stb = $("#stepBtn");
  if (sb) { sb.classList.toggle("is-active", !!tutorMode); sb.setAttribute("aria-pressed", String(!!tutorMode)); }
  if (stb) { stb.classList.toggle("is-active", stepMode); stb.setAttribute("aria-pressed", String(stepMode)); }
  const hint = $("#modeHint");
  if (hint) {
    hint.hidden = !tutorMode && !stepMode;
    const label = hint.querySelector("span");
    if (label) {
      label.textContent = tutorMode
        ? "🎓 Esercitami attivo: il tutor ti guida con domande, senza darti la soluzione."
        : "🪜 Passo-passo attivo: la risposta si rivela un blocco alla volta.";
    }
  }
}
$("#socraticBtn").addEventListener("click", () => {
  const on = tutorMode !== "socratic";
  applyTutorMode(on ? "socratic" : null);
  flash(on ? "Esercitami: il tutor ti guida con domande" : "modalità spiegazione normale");
});
$("#stepBtn").addEventListener("click", () => {
  const on = !stepMode;
  applyTutorMode(on ? "step" : null);
  flash(on ? "Passo-passo: le risposte si rivelano un passo alla volta" : "modalità spiegazione normale");
});
$("#modeHintExit").addEventListener("click", () => { applyTutorMode(null); flash("modalità spiegazione normale"); });

$("#themeBtn").addEventListener("click", () => {
  const dark = !document.body.classList.contains("theme-dark");
  document.body.classList.toggle("theme-dark", dark);
  try { localStorage.setItem("mathapp.dark", dark ? "1" : ""); } catch {}
  applyGgbTheme();
});

// mentre l'IA risponde il pulsante Invia è "Ferma": clic = interrompi (senza inviare)
$("#send").addEventListener("click", (e) => { if (streaming) { e.preventDefault(); stopStreaming(); } });

// ---------- ripasso (scadenze SM-2 + export Anki) ----------
const itDue = (it) => (typeof it.due === "number" ? it.due : (Number(it.t) || 0));
const isDue = (it) => itDue(it) <= Date.now();

async function refreshReviewBadge() {
  const b = $("#reviewBadge");
  if (!b) return;
  try {
    const j = await (await fetch("/api/review")).json();
    const n = (j.items || []).filter(isDue).length;
    b.textContent = String(n);
    b.hidden = !n;
  } catch { b.hidden = true; }
}

async function gradeReview(it, q) {
  try {
    const r = await (await fetch("/api/review/grade", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id: it.id, q }) })).json();
    if (!r.ok) { flash("ripasso: " + (r.error || "non riuscito")); return; }
    const nu = r.item || {};
    flash(q === "difficile" ? "la rivedrai fra 10 minuti" : "prossimo ripasso fra " + nu.interval + (nu.interval === 1 ? " giorno" : " giorni"));
    refreshReview();
    refreshReviewBadge();
  } catch { flash("ripasso: errore di rete"); }
}

async function refreshReview() {
  const list = $("#reviewList");
  const counter = $("#reviewCount");
  try {
    const j = await (await fetch("/api/review")).json();
    const items = (j.items || []).slice().sort((a, b) => itDue(a) - itDue(b));
    const n = items.length;
    const nDue = items.filter(isDue).length;
    if (counter) counter.textContent = n === 0 ? "nessun argomento salvato" : (nDue ? nDue + " da ripassare oggi · " + n + " in tutto" : n + " in tutto · nessuno in scadenza");
    const badge = $("#reviewBadge");
    if (badge) { badge.textContent = String(nDue); badge.hidden = !nDue; }
    if (!n) {
      list.innerHTML = '<div class="hist-empty">Nessun argomento da ripassare.<br>Premi <b>★ Ripasso</b> sotto una risposta per ritrovarla qui.</div>';
      return;
    }
    list.innerHTML = "";
    for (const it of items) {
      const due = isDue(it);
      const row = document.createElement("div"); row.className = "rev-item" + (due ? " rev-due" : "");

      const title = document.createElement("b"); title.className = "rev-title";
      title.textContent = (it.type === "flashcard" ? "🃏 " : "") + (it.title || "Argomento").slice(0, 120);
      const meta = document.createElement("i"); meta.className = "rev-meta";
      meta.textContent = fmtDate(it.t) + (due ? " · da ripassare oggi" : " · prossimo ripasso " + new Date(itDue(it)).toLocaleDateString("it-IT", { day: "2-digit", month: "short" }) + (it.interval ? " (fra " + it.interval + (it.interval === 1 ? " giorno" : " giorni") + ")" : ""));
      const text = document.createElement("div"); text.className = "rev-text";
      renderMD(text, String(it.text || "").trim()); // formattata anche da chiusa: il taglio a 3 righe fa da anteprima

      const actions = document.createElement("div"); actions.className = "rev-actions";
      // valutazione: regola la prossima scadenza (difficile = torna fra 10 minuti)
      actions.append(
        mkBtn("😕 Difficile", () => gradeReview(it, "difficile"), "rev-g rev-g1"),
        mkBtn("🙂 Media", () => gradeReview(it, "media"), "rev-g rev-g2"),
        mkBtn("😎 Facile", () => gradeReview(it, "facile"), "rev-g rev-g3"),
      );
      if (it.convId && !String(it.convId).startsWith("kb:")) {
        actions.append(mkBtn("Apri sessione", async () => {
          $("#reviewDrawer").hidden = true;
          await openConv(it.convId);
        }, "rev-open"));
      }
      const expand = mkBtn("Mostra risposta", () => {
        const open = !row.classList.contains("open");
        row.classList.toggle("open", open);
        expand.textContent = open ? "Nascondi risposta" : "Mostra risposta";
      });
      const del = mkBtn("Elimina", async (ev) => {
        ev.stopPropagation();
        if (!confirm("Togliere «" + String(it.title || "questo argomento").slice(0, 60) + "» dal Ripasso?")) return;
        await fetch("/api/review?id=" + encodeURIComponent(it.id), { method: "DELETE" });
        refreshReview();
        refreshReviewBadge();
      }, "hist-del");
      actions.append(expand, del);

      row.append(title, meta, text, actions);
      list.appendChild(row);
    }
  } catch { list.innerHTML = '<div class="hist-empty">Ripasso non disponibile.</div>'; }
}

// export per Anki: CSV con separatore virgola, HTML attivo (LaTeX reso da Anki)
function ankiCsv(items) {
  const esc = (s) => '"' + String(s || "").replace(/"/g, '""').replace(/\r?\n/g, "<br>") + '"';
  const lines = ["#separator:Comma", "#html:true"];
  for (const it of items) lines.push([esc(it.title || "Argomento"), esc(it.text || "")].join(","));
  return lines.join("\n");
}
window.buildAnkiCsv = ankiCsv; // usata anche dai test
async function exportAnki() {
  try {
    const j = await (await fetch("/api/review")).json();
    const items = j.items || [];
    if (!items.length) { flash("niente da esportare nel Ripasso"); return; }
    const blob = new Blob(["\ufeff" + ankiCsv(items)], { type: "text/csv;charset=utf-8" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob); a.download = "mathapp-ripasso.csv";
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 4000);
    flash("CSV per Anki scaricato (" + items.length + (items.length === 1 ? " scheda" : " schede") + ")");
  } catch { flash("export Anki: errore di rete"); }
}
$("#ankiBtn").addEventListener("click", exportAnki);

$("#reviewBtn").addEventListener("click", () => { const d = $("#reviewDrawer"); d.hidden = !d.hidden; if (!d.hidden) refreshReview(); });
$("#reviewClose").addEventListener("click", () => { $("#reviewDrawer").hidden = true; });

// ---------- quiz: verifica a risposta multipla ----------
const quizDrawer = $("#quizDrawer");
let quizState = null; // { questions, answers, graded, deadline, timerId, timeUp }

function stopQuizTimer() {
  if (quizState && quizState.timerId) { clearInterval(quizState.timerId); quizState.timerId = null; }
}

function updateQuizHint() {
  if (!quizState || quizState.graded) return;
  const done = quizState.answers.filter((a) => a != null).length;
  $("#quizHint").textContent = done + " di " + quizState.questions.length + " risposte";
}

function renderQuiz() {
  const list = $("#quizList");
  list.innerHTML = "";
  quizState.questions.forEach((q, qi) => {
    const card = document.createElement("div");
    card.className = "quiz-q";
    const title = document.createElement("div");
    title.className = "quiz-d";
    title.textContent = (qi + 1) + ". " + q.d;
    card.appendChild(title);
    q.opts.forEach((opt, oi) => {
      const lab = document.createElement("label");
      lab.className = "quiz-opt";
      const inp = document.createElement("input");
      inp.type = "radio";
      inp.name = "quizq" + qi;
      inp.value = String(oi);
      inp.disabled = !!quizState.graded;
      if (quizState.answers[qi] === oi) inp.checked = true;
      if (quizState.graded) {
        if (oi === q.ok) lab.classList.add("ok");
        else if (quizState.answers[qi] === oi) lab.classList.add("ko");
      }
      inp.addEventListener("change", () => { quizState.answers[qi] = oi; updateQuizHint(); });
      const span = document.createElement("span");
      span.textContent = opt;
      lab.append(inp, span);
      card.appendChild(lab);
    });
    if (quizState.graded) {
      const giusta = quizState.answers[qi] === q.ok;
      const fb = document.createElement("div");
      fb.className = giusta ? "quiz-fb" : "quiz-fb ko";
      fb.textContent = (giusta ? "✔ giusta" : "✘ sbagliata — risposta corretta: " + q.opts[q.ok]) + (q.why ? " — " + q.why : "");
      card.appendChild(fb);
    }
    list.appendChild(card);
  });
}

async function quizGenerate() {
  const topic = $("#quizTopic").value.trim();
  if (topic.length < 3) { flash("scrivi l'argomento del quiz"); return; }
  const n = Math.max(3, Math.min(10, Number($("#quizN").value) || 5));
  stopQuizTimer();
  quizState = null;
  $("#quizTimer").hidden = true;
  $("#quizGrade").hidden = true;
  $("#quizHint").textContent = "le risposte sbagliate finiscono nel Ripasso";
  const list = $("#quizList");
  list.innerHTML = "";
  const attesa = document.createElement("div");
  attesa.className = "quiz-note";
  attesa.textContent = "sto preparando le domande…";
  list.appendChild(attesa);
  $("#quizStart").disabled = true;
  try {
    const r = await fetch("/api/quiz", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ topic, n }) });
    const j = await r.json();
    if (!j.ok || !Array.isArray(j.questions) || !j.questions.length) { list.innerHTML = ""; flash(j.error || "quiz non disponibile"); return; }
    quizState = { questions: j.questions, answers: [], graded: false, deadline: 0, timerId: null, timeUp: false };
    renderQuiz();
    $("#quizGrade").hidden = false;
    updateQuizHint();
    if ($("#quizTimed").checked) startQuizTimer(n);
  } catch { list.innerHTML = ""; flash("errore nella generazione del quiz"); }
  finally { $("#quizStart").disabled = false; }
}

function startQuizTimer(minutes) {
  if (!quizState) return;
  quizState.deadline = Date.now() + minutes * 60 * 1000;
  const el = $("#quizTimer");
  el.hidden = false;
  const tick = () => {
    if (!quizState || quizState.graded) return;
    const left = Math.max(0, quizState.deadline - Date.now());
    const mm = Math.floor(left / 60000), ss = Math.floor((left % 60000) / 1000);
    el.textContent = "⏱ " + mm + ":" + String(ss).padStart(2, "0");
    if (left <= 0) { stopQuizTimer(); quizGrade(true); }
  };
  tick();
  quizState.timerId = setInterval(tick, 1000);
}

async function quizGrade(timeUp) {
  if (!quizState || quizState.graded) return;
  quizState.graded = true;
  quizState.timeUp = !!timeUp;
  stopQuizTimer();
  const qs = quizState.questions;
  let ok = 0;
  const wrong = [];
  qs.forEach((q, i) => { if (quizState.answers[i] === q.ok) ok++; else wrong.push(i); });
  renderQuiz();
  $("#quizGrade").hidden = true;
  const esito = document.createElement("div");
  esito.className = "quiz-score";
  const pct = Math.round((ok / qs.length) * 100);
  esito.textContent = "punteggio: " + ok + " su " + qs.length + " (" + pct + "%)" + (timeUp ? " — tempo scaduto" : "") + (ok === qs.length ? " — en plein!" : "");
  $("#quizList").prepend(esito);
  $("#quizHint").textContent = wrong.length ? "gli errori sono finiti nel Ripasso" : "tutto giusto, niente da ripassare";
  for (const i of wrong) {
    try {
      await fetch("/api/review", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          convId: "quiz",
          title: qs[i].d,
          text: qs[i].opts[qs[i].ok] + (qs[i].why ? " — " + qs[i].why : ""),
        }),
      });
    } catch {}
  }
  if (wrong.length) refreshReviewBadge();
}

$("#quizBtn").addEventListener("click", () => { quizDrawer.hidden = !quizDrawer.hidden; if (!quizDrawer.hidden) $("#quizTopic").focus(); });
$("#quizClose").addEventListener("click", () => { quizDrawer.hidden = true; stopQuizTimer(); });
$("#quizStart").addEventListener("click", quizGenerate);
$("#quizGrade").addEventListener("click", () => quizGrade(false));
$("#quizTopic").addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); quizGenerate(); } });

// aggancio per i test automatici (stessa idea di window.__ggb per la lavagna)
window.__quiz = { get: () => quizState, forceTimeUp: () => { if (quizState && !quizState.graded) quizState.deadline = Date.now() - 1; } };

// ---------- ricerca nella cronologia ----------
let histTimer = null;
$("#historySearch").addEventListener("input", () => { clearTimeout(histTimer); histTimer = setTimeout(refreshHistory, 250); });

// ---------- fonti dagli appunti/libri (rete concettuale) ----------
const escapeRe = (s) => String(s).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const STOP_W = new Set(["della","delle","dello","degli","questo","questa","questi","queste","sono","essere","avere","come","anche","perche","quando","dove","quale","quali","tutto","tutti","molto","poco","the","and","for","with","that","this","from","una","uno","gli","dei","che","non","per","con","tra","fra","sul","sui","nel","nei","alla","allo","agli","fare","piu","meno","solo","ogni","sua","suo","suoi","sue","quindi","allora","infatti","vedi","questo","cioe","dopo","prima","stesso","stessa","esempio","esempi","risultato","risultati"]);

// parole "significative": lunghe e non generiche
function sigTerms(s) {
  return String(s || "").toLowerCase().replace(/[^\p{L}\p{N}\s]/gu, " ").split(/\s+/)
    .filter((w) => w.length >= 6 && !STOP_W.has(w));
}

function highlightTerms(text, terms) {
  const esc = escapeHtml(text);
  if (!terms || !terms.length) return esc;
  try {
    const re = new RegExp("\\b(" + terms.map(escapeRe).join("|") + ")\\w*", "gi");
    return esc.replace(re, "<mark>$1</mark>");
  } catch { return esc; }
}

// trova il passaggio dell'estratto che la risposta ha davvero ripreso
// (escludendo le parole che vengono dal NOME del file: "analisi", "appunti"...)
function bestPassage(excerpt, answerTerms, exclude) {
  const sents = String(excerpt || "").split(/(?<=[.!?;:])\s+|\n+/).map((s) => s.trim()).filter((s) => s.length > 15);
  let best = null, bestShared = [], bestScore = -1;
  for (const s of sents) {
    const set = new Set(sigTerms(s));
    const shared = [...set].filter((t) => answerTerms.has(t) && !(exclude && exclude.has(t)));
    // a parità di parole riprese, preferisco la riga con contenuto vero (formule/numeri) e non le intestazioni
    const score = shared.length * 10 + Math.min(set.size, 5) + (/\d/.test(s) ? 5 : 0);
    if (score > bestScore) { bestScore = score; best = s; bestShared = shared; }
  }
  return { sentence: best, shared: bestShared };
}

function renderSources(bubble, data, answer) {
  if (!data || !data.items || !data.items.length) return;
  const answerTerms = new Set(sigTerms(answer || ""));
  const citate = new Set((String(answer || "").match(/\[([^\]\n]+?)\]/g) || []).map((m) => m.toLowerCase()));

  const usate = [];
  for (const s of data.items) {
    const esplicitamente = [...citate].some((c) => c.includes(String(s.doc).toLowerCase()));
    const nameWords = new Set(sigTerms(s.doc));
    const { sentence, shared } = bestPassage(s.text, answerTerms, nameWords);
    // la mostro solo se l'IA l'ha citata oppure se ha ripreso davvero almeno 2 parole significative
    if (esplicitamente || shared.length >= 2) usate.push({ s, sentence, shared });
  }
  if (!usate.length) return; // l'IA non si è riferita agli appunti: nessuna casella

  const box = document.createElement("div"); box.className = "sources";
  const h = document.createElement("div"); h.className = "sources-head";
  h.textContent = "📚 Dagli appunti" + (usate.length > 1 ? " (" + usate.length + ")" : "");
  box.appendChild(h);

  for (const { s, sentence, shared } of usate) {
    const row = document.createElement("div"); row.className = "source";
    const t = document.createElement("div"); row.appendChild(t);
    t.className = "source-title";
    t.textContent = s.doc + (s.page ? " · pag. " + s.page : "");
    const q = document.createElement("blockquote"); q.className = "source-quote";
    const passaggio = shared.length ? (sentence || String(s.text).slice(0, 260)) : String(s.text).slice(0, 300);
    q.innerHTML = shared.length ? highlightTerms(passaggio, shared) : escapeHtml(passaggio);
    row.appendChild(q);
    if (s.id) {
      const a = document.createElement("a");
      a.className = "source-open"; a.href = "/api/kb/file?id=" + encodeURIComponent(s.id); a.target = "_blank"; a.rel = "noopener";
      a.textContent = "Apri il file originale";
      row.appendChild(a);
    }
    box.appendChild(row);
  }
  bubble.appendChild(box);
}

// ---------- pannello Appunti (rete concettuale) ----------
// caricamento diretto di appunti nella sezione Appunti
$("#kbUpload").addEventListener("click", () => $("#kbFile").click());
$("#kbFile").addEventListener("change", (e) => { kbCarica(Array.from(e.target.files || [])); e.target.value = ""; });
(() => {
  const d = $("#kbDrawer");
  d.addEventListener("dragover", (e) => { e.preventDefault(); d.classList.add("drop-target"); });
  d.addEventListener("dragleave", () => d.classList.remove("drop-target"));
  d.addEventListener("drop", (e) => {
    e.preventDefault(); d.classList.remove("drop-target");
    if (e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files.length) kbCarica(Array.from(e.dataTransfer.files));
  });
})();

async function kbCarica(files) {
  if (!files.length) return;
  const st = $("#kbStatus");
  let ok = 0;
  for (const f of files) {
    if (f.size > 40 * 1024 * 1024) { st.textContent = "«" + f.name + "» troppo grande (max 40 MB)"; continue; }
    st.textContent = "elaboro «" + f.name + "»…";
    try {
      const b64 = await b64FromBlob(f);
      const r = await fetch("/api/kb/add", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name: f.name, mime: f.type || "application/octet-stream", b64 }) });
      const j = await r.json();
      if (j.ok) { ok++; st.textContent = "«" + f.name + "» aggiunto (" + (j.doc.chunks || 0) + " blocchi)"; }
      else st.textContent = "«" + f.name + "»: " + (j.error || "non leggibile");
    } catch (err) { st.textContent = "«" + f.name + "»: errore " + err.message; }
  }
  refreshKb();
  if (ok) setTimeout(() => { const s = $("#kbStatus"); if (s) s.textContent = ""; }, 3000);
}

async function refreshKb() {
  const list = $("#kbList");
  try {
    const j = await (await fetch("/api/kb")).json();
    if (!j.docs.length) {
      list.innerHTML = '<div class="hist-empty">Nessun appunto ancora.<br>Premi «Carica appunti» oppure allega un file in chat.</div>';
      $("#kbViewer").hidden = true;
      return;
    }
    list.innerHTML = "";
    for (const d of j.docs) {
      const row = document.createElement("div"); row.className = "kb-item";
      const t = document.createElement("div"); t.className = "t";
      const b = document.createElement("b"); b.textContent = d.name;
      const s = document.createElement("span");
      const parti = [fmtDate(d.addedAt)];
      if (d.chunks) parti.push(d.chunks + " blocchi");
      if (d.chars) parti.push(Math.round(d.chars / 1000) + "k caratteri");
      if (d.file) parti.push(Math.round(d.file.size / 1024) + " KB");
      s.textContent = parti.join(" · ");
      t.append(b, s);
      row.append(t);
      if (d.file) {
        const open = document.createElement("a");
        open.className = "kb-open";
        open.href = "/api/kb/file?id=" + encodeURIComponent(d.id);
        open.target = "_blank"; open.rel = "noopener"; open.textContent = "Apri";
        open.addEventListener("click", (ev) => ev.stopPropagation()); // FIX: non aprire anche il testo
        row.append(open);
      }
      if (d.chunks) {
        row.append(mkBtn("🃏 Flashcard", async (ev) => {
          ev.stopPropagation();
          const b = ev.currentTarget;
          b.disabled = true; const old = b.textContent; b.textContent = "🃏 creo…";
          try {
            const r = await (await fetch("/api/flashcards", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ docId: d.id }) })).json();
            flash(r.ok ? ("Ripasso: +" + r.added + " flashcard" + (r.parsed > r.added ? " (" + (r.parsed - r.added) + " già presenti)" : "")) : ("flashcard: " + (r.error || "non riuscite")));
            if (r.ok) refreshReviewBadge();
          } catch { flash("flashcard: errore di rete"); }
          b.disabled = false; b.textContent = old;
        }, "kb-flash"));
      }
      row.append(mkBtn("Elimina", async (ev) => {
        ev.stopPropagation();
        if (!confirm("Togliere «" + d.name + "» dagli appunti?\nIl file viene spostato nel cestino (recuperabile), le citazioni non compariranno più.")) return;
        await fetch("/api/kb/doc?id=" + encodeURIComponent(d.id), { method: "DELETE" });
        const v = $("#kbViewer");
        if (v.dataset.doc === d.id) { v.hidden = true; v.dataset.doc = ""; }
        refreshKb();
      }, "hist-del"));
      row.addEventListener("click", () => openKbDoc(d));
      list.appendChild(row);
    }
  } catch { list.innerHTML = '<div class="hist-empty">Rete concettuale non disponibile.</div>'; }
}

async function openKbDoc(doc) {
  const v = $("#kbViewer");
  v.hidden = false; v.dataset.doc = doc.id;
  v.innerHTML = '<p class="kb-chunk">carico…</p>';
  try {
    const j = await (await fetch("/api/kb/doc?id=" + encodeURIComponent(doc.id))).json();
    if (v.dataset.doc !== doc.id) return; // nel frattempo hai aperto altro
    v.innerHTML = "";
    const bar = document.createElement("div"); bar.className = "kb-viewer-head";
    const head = document.createElement("div"); head.className = "sources-head";
    head.textContent = doc.name + " — " + (j.chunks || []).length + " blocchi";
    bar.append(head, mkBtn("Chiudi", () => { v.hidden = true; v.dataset.doc = ""; }, "kb-open"));
    v.appendChild(bar);
    if (!j.chunks || !j.chunks.length) {
      const e = document.createElement("p"); e.className = "kb-chunk";
      e.textContent = "Nessun testo indicizzato (es. immagine o PDF scansionato). Il file è comunque archiviato e apribile con «Apri».";
      v.appendChild(e);
      return;
    }
    for (const c of j.chunks.slice(0, 80)) {
      const el = document.createElement("div"); el.className = "kb-chunk";
      if (c.page) { const pg = document.createElement("span"); pg.className = "pg"; pg.textContent = "pagina " + c.page; el.appendChild(pg); }
      el.appendChild(document.createTextNode(c.text));
      v.appendChild(el);
    }
    if (j.chunks.length > 80) {
      const m = document.createElement("p"); m.className = "kb-chunk";
      m.textContent = "…altri " + (j.chunks.length - 80) + " blocchi non mostrati (usa «Apri» per il file completo).";
      v.appendChild(m);
    }
  } catch { if (v.dataset.doc === doc.id) v.innerHTML = '<p class="kb-chunk">errore nel caricamento</p>'; }
}

$("#kbBtn").addEventListener("click", () => { const d = $("#kbDrawer"); d.hidden = !d.hidden; if (!d.hidden) refreshKb(); });
$("#kbClose").addEventListener("click", () => { $("#kbDrawer").hidden = true; });

// ---------- stile imparato (memoria dell'IA) ----------
async function refreshStyle() {
  const list = $("#styleList");
  try {
    const j = await (await fetch("/api/profile")).json();
    if (!j.items.length) {
      list.innerHTML = '<div class="hist-empty">Ancora nulla.<br>L\'IA impara quando la correggi sullo stile, oppure aggiungi tu una preferenza qui sopra.</div>';
      return;
    }
    list.innerHTML = "";
    for (const c of j.items) {
      const row = document.createElement("div"); row.className = "rev-item";
      const t = document.createElement("div"); t.className = "t";
      const b = document.createElement("b"); b.textContent = c.testo;
      const s = document.createElement("span");
      s.textContent = (c.source === "IA" ? "imparata dall'IA" : "aggiunta da te") + " · riletta " + (c.hits || 0) + " volte";
      t.append(b, s);
      const del = mkBtn("Elimina", async (ev) => {
        ev.stopPropagation();
        await fetch("/api/profile?id=" + encodeURIComponent(c.id), { method: "DELETE" });
        refreshStyle();
      }, "hist-del");
      row.append(t, del);
      list.appendChild(row);
    }
  } catch { list.innerHTML = '<div class="hist-empty">Memoria non disponibile.</div>'; }
}

async function addStyle() {
  const v = $("#styleInput").value.trim();
  if (!v) return;
  const r = await fetch("/api/profile", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ testo: v }) });
  if (r.ok) { $("#styleInput").value = ""; refreshStyle(); flash("preferenza salvata: la rileggerò prima di rispondere"); }
  else flash("preferenza troppo corta");
}

$("#styleBtn").addEventListener("click", () => { const d = $("#styleDrawer"); d.hidden = !d.hidden; if (!d.hidden) refreshStyle(); });
$("#styleClose").addEventListener("click", () => { $("#styleDrawer").hidden = true; });
$("#styleAdd").addEventListener("click", addStyle);
$("#styleInput").addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); addStyle(); } });

// ---------- dettatura vocale (trascrizione locale con Whisper) ----------
let mediaRec = null, recChunks = [], recTimer = null, recStart = 0, recBusy = false;

function b64FromBlob(blob) {
  return new Promise((resolve) => {
    const fr = new FileReader();
    fr.onload = () => { const s = String(fr.result || ""); resolve(s.slice(s.indexOf(",") + 1)); };
    fr.readAsDataURL(blob);
  });
}

async function transcribeBlob(blob) {
  flash("trascrivo in locale… (può richiedere qualche secondo)");
  try {
    const b64 = await b64FromBlob(blob);
    const r = await fetch("/api/transcribe", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ b64 }) });
    const j = await r.json();
    if (j && j.ok && j.text) {
      inputEl.value = (inputEl.value.trim() ? inputEl.value.replace(/\s+$/, "") + " " : "") + j.text;
      inputEl.focus();
      flash("trascrizione pronta (" + j.language + " " + Math.round((j.language_probability || 0) * 100) + "%): controlla e invia");
    } else if (j && j.ok) {
      flash("non ho sentito nulla: riprova parlando più vicino al microfono");
    } else {
      flash("trascrizione non riuscita: " + ((j && j.error) || "errore"));
    }
  } catch (e) { flash("trascrizione non riuscita: " + e.message); }
}

let micBusyTimer = null;
function setMicBusy(on) {
  const b = $("#micBtn");
  if (on) {
    recBusy = true;
    clearInterval(recTimer);
    b.classList.remove("recording");
    b.classList.add("transcribing");
    b.disabled = true;
    const t0 = Date.now();
    const tick = () => { b.textContent = "✍ " + Math.round((Date.now() - t0) / 1000) + "s"; };
    tick();
    micBusyTimer = setInterval(tick, 500);
  } else {
    recBusy = false;
    clearInterval(micBusyTimer);
    micBusyTimer = null;
    b.classList.remove("transcribing");
    b.disabled = false;
    b.textContent = "🎤";
  }
}

async function toggleMic() {
  if (recBusy) return;
  if (mediaRec && mediaRec.state === "recording") { mediaRec.stop(); return; }
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    const tipo = MediaRecorder.isTypeSupported("audio/webm") ? "audio/webm" : (MediaRecorder.isTypeSupported("audio/ogg") ? "audio/ogg" : "");
    mediaRec = tipo ? new MediaRecorder(stream, { mimeType: tipo }) : new MediaRecorder(stream);
    recChunks = [];
    mediaRec.ondataavailable = (e) => { if (e.data && e.data.size) recChunks.push(e.data); };
    mediaRec.onstop = async () => {
      try { stream.getTracks().forEach((t) => t.stop()); } catch {}
      clearInterval(recTimer);
      const blob = new Blob(recChunks, { type: mediaRec.mimeType || "audio/webm" });
      if (blob.size > 800) {
        setMicBusy(true);
        try { await transcribeBlob(blob); } finally { setMicBusy(false); }
      } else {
        $("#micBtn").classList.remove("recording");
        $("#micBtn").textContent = "🎤";
        flash("registrazione troppo breve");
      }
    };
    mediaRec.start();
    recStart = Date.now();
    $("#micBtn").classList.add("recording");
    $("#micBtn").textContent = "■ 0s";
    recTimer = setInterval(() => {
      const s = Math.round((Date.now() - recStart) / 1000);
      $("#micBtn").textContent = "■ " + s + "s";
      if (s >= 120) mediaRec.stop(); // limite di sicurezza
    }, 250);
    flash("registro… premi di nuovo per fermare");
  } catch (e) {
    flash("microfono non disponibile: " + e.message);
  }
}
$("#micBtn").addEventListener("click", toggleMic);

// ---------- export ----------
async function exportPdf() {
  const css = await fetch("/style.css").then((r) => r.text()).catch(() => "");
  const title = ((messages.find((m) => m.role === "user") || {}).content || "Sessione MathApp").slice(0, 80);
  const html = '<!doctype html><html lang="it"><head><meta charset="utf-8"><title>' + escapeHtml(title) + '</title>'
    + '<link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/katex@0.16.9/dist/katex.min.css">'
    + "<style>" + css + "\n@media print{.msg-actions,.step-ctl,.ggb-card,.edit-btn,.jump-btn{display:none!important}body{background:#fff}#main{padding:0}#chatpanel{border:none;box-shadow:none}}"
    + '</style></head><body><main id="main"><section id="chatpanel"><div class="chat-heading"><div><span class="section-label">' + escapeHtml(title)
    + '</span><p>Esportato il ' + new Date().toLocaleString("it-IT") + "</p></div></div><div id=\"chat\">" + chatEl.innerHTML + "</div></section></main></body></html>";
  const w = window.open("", "_blank");
  if (!w) { flash("consenti i popup per esportare"); return; }
  w.document.write(html); w.document.close();
  setTimeout(() => { try { w.focus(); w.print(); } catch {} }, 900);
  flash("finestra pronta: salva come PDF");
}

// PDF del quaderno: le voci di calcolo in un foglio pronto da stampare.
async function exportNotebookPdf() {
  const cells = $("#calcCells");
  if (!cells || !cellData.length) { flash("il quaderno è vuoto: niente da esportare"); return; }
  const css = await fetch("/style.css").then((r) => r.text()).catch(() => "");
  const title = ((messages.find((m) => m.role === "user") || {}).content || "Quaderno MathApp").slice(0, 80);
  const tmp = cells.cloneNode(true);
  [...tmp.children].reverse().forEach((c) => tmp.appendChild(c)); // dal primo calcolo all'ultimo
  const body = tmp.innerHTML.replace(/<details(?![\w-])/g, "<details open");
  const html = '<!doctype html><html lang="it"><head><meta charset="utf-8"><title>' + escapeHtml(title) + '</title>'
    + '<link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/katex@0.16.9/dist/katex.min.css">'
    + "<style>" + css + "\n@media print{.cell-actions,.cell-explain,.ggb-card,.jump-btn,.edit-btn{display:none!important}body{background:#fff}#main{padding:0}#panelAlgebra{border:none;box-shadow:none}}"
    + '</style></head><body><main id="main"><section id="panelAlgebra"><div class="panel-heading"><div><span class="section-label">Quaderno di algebra</span><p>'
    + escapeHtml(title) + " — esportato il " + new Date().toLocaleString("it-IT")
    + '</p></div></div><div id="calcCells">' + body + "</div></section></main></body></html>";
  const w = window.open("", "_blank");
  if (!w) { flash("consenti i popup per esportare"); return; }
  w.document.write(html); w.document.close();
  setTimeout(() => { try { w.focus(); w.print(); } catch {} }, 900);
  flash("quaderno pronto: salva come PDF");
}

function exportMarkdown() {
  const title = ((messages.find((m) => m.role === "user") || {}).content || "Sessione MathApp").slice(0, 100);
  const lines = ["# " + title, "", "_Esportato il " + new Date().toLocaleString("it-IT") + "_", ""];
  for (const m of messages) lines.push(m.role === "user" ? "## Domanda" : "## Risposta", "", m.content || "", "");
  if (cellData.length) {
    lines.push("## Calcoli (quaderno)", "");
    for (const c of cellData) lines.push("- `" + (c.op || "") + " " + (c.expr || "") + "` = `" + String((c.res && c.res.result) || "") + "`");
  }
  if (figures.length) {
    lines.push("", "## Costruzioni GeoGebra", "");
    figures.forEach((f, i) => lines.push((i + 1) + ". **" + (f.title || "figura") + "** — " + (f.commands || []).length + " comandi"));
  }
  const blob = new Blob([lines.join("\n")], { type: "text/markdown;charset=utf-8" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = "mathapp-sessione.md";
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 4000);
  flash("Markdown scaricato");
}
$("#exportPdf").addEventListener("click", () => exportPdf());
$("#exportMd").addEventListener("click", () => exportMarkdown());
$("#calcPdf").addEventListener("click", () => exportNotebookPdf());

// ---------- scorciatoie da tastiera ----------
window.addEventListener("keydown", (e) => {
  if (e.key === "Escape" && streaming) { stopStreaming(); return; }
  const ctrl = e.ctrlKey || e.metaKey;
  const inField = e.target && e.target.closest && e.target.closest("input, textarea, [contenteditable]");
  if (ctrl && !inField && e.key.toLowerCase() === "z" && !e.shiftKey) { e.preventDefault(); boardUndo(); return; }
  if (ctrl && !inField && (e.key.toLowerCase() === "y" || (e.shiftKey && e.key.toLowerCase() === "z"))) { e.preventDefault(); boardRedo(); return; }
  if (ctrl && e.key.toLowerCase() === "k") { e.preventDefault(); setMode("figure"); inputEl.focus(); return; }
  if (e.altKey && e.key.toLowerCase() === "n") { e.preventDefault(); $("#newChat").click(); return; }
  if (e.altKey && e.key.toLowerCase() === "r") { e.preventDefault(); regenerate(); return; }
  if (e.key === "ArrowUp" && document.activeElement === inputEl && !inputEl.value.trim()) {
    const u = [...messages].reverse().find((m) => m.role === "user");
    if (u) { e.preventDefault(); inputEl.value = u.content; }
  }
});

function initPreferences() {
  try {
    if (localStorage.getItem("mathapp.dark") === "1") document.body.classList.add("theme-dark");
    if (localStorage.getItem("mathapp.socratic") === "1") applyTutorMode("socratic");
    else if (localStorage.getItem("mathapp.step") === "1") applyTutorMode("step");
  } catch {}
}

// ---------- impostazioni: API key e preferenze ----------
let settingsData = null;

function applyMode(mode) {
  document.body.classList.toggle("mode-core", mode !== "full");
}

async function loadDiagnostics() {
  const el = $("#diagStatus");
  if (!el) return;
  try {
    const r = await fetch("/api/diagnostics");
    const d = await r.json();
    el.textContent = "Node " + d.node + " · Python " + (d.python || "non installato") + " · SymPy " + (d.sympy || "non installato") + " · Whisper " + (d.whisper ? "ok" : "non installato") + " · Modo " + (d.mode === "full" ? "completo" : "essenziale");
  } catch { el.textContent = "diagnostica non disponibile"; }
}

async function loadSettings() {
  try { const r = await fetch("/api/settings"); settingsData = await r.json(); } catch { settingsData = null; }
  const d = settingsData;
  if (!d || !d.ok) return;
  applyMode(d.mode || "core");
  const modeSel = $("#setMode"); if (modeSel) modeSel.value = d.mode || "core";
  const banner = $("#setupBanner"); if (banner) banner.hidden = !!d.hasKey;
  const prov = $("#setProvider"); if (prov) prov.value = d.provider || "openrouter";
  const keyEl = $("#setKey"); if (keyEl) keyEl.value = "";
  const ks = $("#setKeyState");
  if (ks) ks.textContent = d.hasKey ? (d.keySource === "settings" ? ("chiave salvata (..." + d.keyHint + ")") : "chiave esistente (auth OpenCode locale)") : "nessuna chiave configurata";
  const clear = $("#settingsClearKey"); if (clear) clear.hidden = !(d.hasKey && d.keySource === "settings");
  const lang = $("#setLang"); if (lang) lang.value = d.whisperLanguage || "it";
  const mdl = $("#setModel");
  if (mdl) {
    try {
      const mr = await fetch("/api/models"); const mj = await mr.json();
      mdl.innerHTML = mj.models.map((m) => `<option value="${m}">${m}</option>`).join("");
      mdl.value = d.model || mj.default;
    } catch {}
  }
  loadDiagnostics();
}

async function saveSettings(extra) {
  const msg = $("#settingsMsg");
  const body = Object.assign({
    provider: $("#setProvider").value,
    whisperLanguage: $("#setLang").value
  }, extra || {});
  const mv = $("#setModel").value; if (mv) body.model = mv;
  const modeEl = $("#setMode"); if (modeEl) body.mode = modeEl.value;
  const k = $("#setKey").value.trim();
  if (k) body.apiKey = k;
  try {
    const r = await fetch("/api/settings", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    const j = await r.json();
    if (!j.ok) { if (msg) msg.textContent = "Errore: " + (j.err || "salvataggio fallito"); return; }
    if (msg) msg.textContent = "Salvato.";
    if (j.model) { currentModel = j.model; if (modelEl) modelEl.value = j.model; }
    if (j.mode) { applyMode(j.mode); const ms = $("#setMode"); if (ms) ms.value = j.mode; }
    await loadSettings();
    try {
      const mr = await fetch("/api/models"); const mj = await mr.json();
      const vis = mj.vision || {};
      modelEl.innerHTML = mj.models.map((m) => `<option value="${m}">${m}${vis[m] === false ? " (solo testo)" : ""}</option>`).join("");
      currentModel = mj.default || currentModel;
      modelEl.value = currentModel;
    } catch {}
  } catch (e) { if (msg) msg.textContent = "Errore di rete"; }
}

function initSettingsUI() {
  const d = $("#settingsDrawer"); if (!d) return;
  $("#settingsBtn").addEventListener("click", () => { d.hidden = !d.hidden; if (!d.hidden) loadSettings(); });
  $("#settingsClose").addEventListener("click", () => { d.hidden = true; });
  const so = $("#setupOpen"); if (so) so.addEventListener("click", () => { d.hidden = false; loadSettings(); });
  $("#settingsSave").addEventListener("click", () => saveSettings());
  $("#settingsClearKey").addEventListener("click", () => saveSettings({ clearKey: true }));
  const dr = $("#diagRefresh"); if (dr) dr.addEventListener("click", () => { loadDiagnostics(); });
}

initSettingsUI();

async function boot() {
  initGGB();
  setMode("figure");
  initPreferences();
  setTimeout(() => { try { applyGgbTheme(); } catch {} }, 1500);
  try {
    const r = await fetch("/api/models"); const j = await r.json();
    const vis = j.vision || {};
    modelEl.innerHTML = j.models.map((m) => `<option value="${m}">${m}${vis[m] === false ? " · solo testo" : ""}</option>`).join("");
    currentModel = j.default || currentModel; modelEl.value = currentModel;
    modelEl.addEventListener("change", () => (currentModel = modelEl.value));
  } catch { modelEl.innerHTML = `<option>${currentModel}</option>`; }
  await loadSettings();
  await restoreSession();
  try { if (!localStorage.getItem("mathapp.conv")) localStorage.setItem("mathapp.conv", conversationId); } catch {}
  booting = false;
  refreshReviewBadge();
}
window.addEventListener("DOMContentLoaded", boot);
