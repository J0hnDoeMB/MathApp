// MathApp front-end: chat con streaming + KaTeX + GeoGebra pilotato dall'IA.
const appState = window.MathAppState;

// Offline shell: cache static/CDN GET assets after the first visit. API calls
// and user data are never cached. Registration is best-effort.
if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("/sw.js").catch(() => {});
  });
}
const $ = (s) => document.querySelector(s);
const chatEl = $("#chat"), inputEl = $("#input"), sendBtn = $("#send");
const statusEl = $("#status"), modelEl = $("#model"), mainEl = $("#main");

let ggbApplet = null;
let ggbReady = false;
const ggbReadyPromise = new Promise((r) => { window.__ggbResolve = r; });
let ggbWorkQueue = Promise.resolve();

function enqueueGgbWork(expectedGeneration, work) {
  const task = ggbWorkQueue.catch(() => {}).then(async () => {
    await ggbReadyPromise;
    if (expectedGeneration !== appState.domain.conversationGeneration) return false;
    return await work();
  });
  ggbWorkQueue = task.catch((e) => { console.warn("[MathApp] operazione GeoGebra fallita", e); return false; });
  return task;
}

function queueGgbClear(expectedGeneration = appState.domain.conversationGeneration) {
  return enqueueGgbWork(expectedGeneration, () => {
    if (expectedGeneration !== appState.domain.conversationGeneration) return false;
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

async function applyCommands(commands, expectedGeneration = appState.domain.conversationGeneration) {
  await ggbReadyPromise;
  if (expectedGeneration !== appState.domain.conversationGeneration) return [];
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

function refreshFigureList() {
  const sel = $("#figSel");
  if (!sel) return;
  if (!appState.domain.figures.length) { sel.disabled = true; sel.innerHTML = '<option value="">nessuna costruzione</option>'; return; }
  sel.disabled = false;
  sel.innerHTML = '<option value="">Costruzioni (' + appState.domain.figures.length + ')</option>' +
    appState.domain.figures.map((f, i) => '<option value="' + escapeHtml(f.fid) + '">' + (i + 1) + ". " + (f.view === "3d" ? "[3D] " : "") + escapeHtml(f.title || "figura") + "</option>").join("");
}

async function runFigure(fig, mode, expectedGeneration = appState.domain.conversationGeneration) {
  await ggbReadyPromise;
  if (expectedGeneration !== appState.domain.conversationGeneration || appState.ui.conversationLoading) return { okN: 0, total: (fig.commands || []).length };
  setView3d(fig.view === "3d", expectedGeneration); // la figura vive nella sua vista
  if (mode === "replace") { try { ggbApplet.newConstruction(); applyGgbTheme(); } catch {} }
  pushUndoPoint(); // annulla = toglie questa costruzione dalla lavagna
  const res = await applyCommands(fig.commands, expectedGeneration);
  pushUndoPoint(); // …e ripeti = la rimette
  if (expectedGeneration !== appState.domain.conversationGeneration) return { okN: 0, total: (fig.commands || []).length };
  const okN = res.filter((r) => r.ok).length;
  refreshFigureList();
  if (expectedGeneration === appState.domain.conversationGeneration) saveState();
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
  if (!appState.domain.ggb3d) return;
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
    if (!ggbReady || !appState.domain.ggb3d) return;
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
    b.classList.toggle("is-on", appState.domain.ggb3d);
    b.setAttribute("aria-pressed", String(appState.domain.ggb3d));
    b.title = appState.domain.ggb3d ? "Torna alla vista 2D" : "Mostra la vista 3D (solidi, superfici, funzioni di due variabili)";
  }
  const r = $("#view3dReset");
  if (r) r.hidden = !appState.domain.ggb3d;
}
function setView3d(on, expectedGeneration = appState.domain.conversationGeneration) {
  on = !!on;
  if (expectedGeneration !== appState.domain.conversationGeneration) return;
  if (ggbReady && on !== appState.domain.ggb3d) {
    try { ggbApplet.setPerspective(on ? "+T" : "-T"); } catch (e) { console.warn("[MathApp] vista 3D non applicata", e); }
  }
  appState.domain.ggb3d = on;
  updateViewButton();
}
function toggleView3d() { setView3d(!appState.domain.ggb3d); saveState(); return appState.domain.ggb3d; }
$("#view3d").addEventListener("click", () => MathAppState.dispatch("view.toggle3d").catch((err) => console.warn("[MathApp] view.toggle3d", err)));
updateViewButton();

// ---------- finestra del grafico: vista 2D personalizzata ----------
// La finestra [xmin,xmax]x[ymin,ymax] dell'applet si legge dall'XML (coordSystem + size)
// e si applica con setCoordSystem; assi e griglia con le API dedicate.

function viewFinite(v) {
  return !!v && [v.xmin, v.xmax, v.ymin, v.ymax].every((n) => Number.isFinite(n)) && v.xmin < v.xmax && v.ymin < v.ymax;
}

function viewFromBoard() {
  if (!ggbReady) return appState.domain.viewCache;
  try {
    const block = (ggbApplet.getXML().match(/<euclidianView>[\s\S]*?<\/euclidianView>/) || [""])[0];
    if (!block) return appState.domain.viewCache;
    const tag = (re) => (block.match(re) || [""])[0];
    const num = (t, name) => { const m = String(t).match(new RegExp("\\b" + name + '="([^"]+)"')); return m ? parseFloat(m[1]) : NaN; };
    const flag = (t, name) => { const m = String(t).match(new RegExp("\\b" + name + '="([^"]+)"')); return m ? m[1] === "true" : null; };
    const sizeTag = tag(/<size [^>]*>/), csTag = tag(/<coordSystem [^>]*>/), evTag = tag(/<evSettings [^>]*>/);
    const W = num(sizeTag, "width"), H = num(sizeTag, "height");
    const x0 = num(csTag, "xZero"), y0 = num(csTag, "yZero"), sx = num(csTag, "scale"), sy = num(csTag, "yscale");
    if (![W, H, x0, y0, sx, sy].every(Number.isFinite) || sx <= 0 || sy <= 0) return appState.domain.viewCache;
    const rec = {
      xmin: -x0 / sx, xmax: (W - x0) / sx,
      ymin: (y0 - H) / sy, ymax: y0 / sy,
      axes: flag(evTag, "axes"), grid: flag(evTag, "grid"),
    };
    if (viewFinite(rec)) { appState.domain.viewCache = rec; return rec; }
    return appState.domain.viewCache;
  } catch { return appState.domain.viewCache; }
}

function applyViewToBoard(rec) {
  if (!ggbReady || appState.domain.ggb3d || !viewFinite(rec)) return false;
  let done = false;
  try { ggbApplet.setCoordSystem(rec.xmin, rec.xmax, rec.ymin, rec.ymax); done = true; } catch (e) { console.warn("[MathApp] setCoordSystem non riuscito", e); }
  if (!done) {
    try { ggbApplet.evalCommand("ZoomIn(" + fmtViewNum(rec.xmin) + "," + fmtViewNum(rec.ymin) + "," + fmtViewNum(rec.xmax) + "," + fmtViewNum(rec.ymax) + ")"); done = true; } catch {}
  }
  if (!done) return false;
  appState.domain.viewCache = rec; // anche a lavagna nascosta la finestra applicata è quella giusta
  try { if (typeof rec.axes === "boolean" && ggbApplet.setAxesVisible) ggbApplet.setAxesVisible(rec.axes, rec.axes); } catch {}
  try { if (typeof rec.grid === "boolean" && ggbApplet.setGridVisible) ggbApplet.setGridVisible(rec.grid); } catch {}
  return true;
}

function viewPanelSync() {
  const cur = viewFromBoard() || appState.domain.viewCustom;
  const base = cur || { xmin: -10, xmax: 10, ymin: -10, ymax: 10 };
  const set = (id, v) => { const el = $(id); if (el) el.value = fmtViewNum(v); };
  set("#vxmin", base.xmin); set("#vxmax", base.xmax); set("#vymin", base.ymin); set("#vymax", base.ymax);
  const ax = $("#vaxes"), gr = $("#vgrid");
  if (ax) ax.checked = cur && cur.axes !== null && cur.axes !== undefined ? !!cur.axes : true;
  if (gr) gr.checked = !!(cur && cur.grid);
}

function applyView(rec, persist) {
  if (appState.domain.ggb3d) { flash("la finestra vale per il piano 2D: prima esci dalla vista 3D"); return false; }
  if (!applyViewToBoard(rec)) { flash("finestra non applicata"); return false; }
  appState.domain.viewCustom = rec;
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
  for (let i = appState.domain.cellData.length - 1; i >= 0; i--) {
    const c = appState.domain.cellData[i];
    if (c && c.res && c.res.draw) return c.res;
  }
  return null;
}

function collectFitPoints() {
  const pts = [];
  const lastFig = appState.domain.figures[appState.domain.figures.length - 1];
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
  if (!ggbReady || appState.domain.ggb3d) return false;
  const pts = collectFitPoints().concat((opts && opts.points) || []);
  const fns = ((opts && opts.functions) || []).slice();
  const lastFig = appState.domain.figures[appState.domain.figures.length - 1];
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
  const base = appState.domain.viewCustom || cur || { axes: true, grid: false };
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
  if (appState.ui.streaming || appState.ui.conversationLoading) { flash("attendi il caricamento o la risposta in corso…"); return; }
  if (!appState.domain.figures.length) { flash("nessuna costruzione da svuotare"); return; }
  appState.domain.figures = []; appState.domain.figSeq = 0;
  for (const c of [...chatEl.querySelectorAll(".ggb-card")]) c.remove();
  refreshFigureList();
  const generation = appState.domain.conversationGeneration;
  queueGgbClear(generation).then(() => { if (generation === appState.domain.conversationGeneration) saveState(); });
  flash("costruzioni svuotate");
});

$("#figSel").addEventListener("change", async (e) => {
  const fid = e.target.value;
  e.target.value = "";
  if (appState.ui.conversationLoading) { flash("attendi il caricamento dell'argomento…"); return; }
  if (!fid) return;
  const fig = appState.domain.figures.find((f) => f.fid === fid);
  if (!fig) return;
  const card = document.querySelector('.ggb-card[data-fid="' + fid + '"]');
  const st = card ? card.querySelector(".ggb-state") : null;
  if (st) st.textContent = "mostro…";
  const r = await runFigure(fig, "replace");
  if (st) { st.textContent = "eseguita (" + r.okN + "/" + r.total + ")"; card.classList.add("done"); }
});

// modifica geometria esistente via API GeoGebra
async function execEdits(callId, ops, expectedGeneration = appState.domain.conversationGeneration) {
  await ggbReadyPromise;
  if (expectedGeneration !== appState.domain.conversationGeneration) return;
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

// Markdown/KaTeX: estratti in public/core/markdown.js (classic script, no build).
const { fixMathNotation, renderMD } = window.MathAppMarkdown;
const { escapeHtml, fmtViewNum, fmt6, fmtDate, fmtSize } = window.MathAppFormat;

// ---------- chat ----------
// Auto-scroll rispettoso: se stai leggendo più in alto, non ti riporta giù.
const jumpBtn = $("#jumpBtn");
const atBottom = () => chatEl.scrollHeight - chatEl.scrollTop - chatEl.clientHeight < 80;
function stick(force) {
  if (force || appState.ui.autoFollow) {
    chatEl.scrollTop = chatEl.scrollHeight;
    if (jumpBtn) jumpBtn.hidden = true;
  } else if (jumpBtn) {
    jumpBtn.hidden = false;
  }
}
chatEl.addEventListener("scroll", () => {
  appState.ui.autoFollow = atBottom();
  if (appState.ui.autoFollow && jumpBtn) jumpBtn.hidden = true;
});
if (jumpBtn) jumpBtn.addEventListener("click", () => { appState.ui.autoFollow = true; stick(true); });

function addMsg(role) {
  const w = $("#chatWelcome"); if (w) w.hidden = true;
  const d = document.createElement("div");
  d.className = "msg " + role;
  chatEl.appendChild(d);
  stick();
  return d;
}


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
  if (appState.ui.streaming || appState.ui.conversationLoading) return;
  const atts = appState.ui.pending.slice();
  appState.ui.pending = []; renderChips();
  const um = { role: "user", content: text };
  if (atts.length) um.attachments = atts;
  appState.domain.messages.push(um);
  const b = makeUserBubble(text, atts);
  b.dataset.idx = appState.domain.messages.length - 1;
  try { localStorage.removeItem("mathapp.empty"); } catch {}
  appState.ui.autoFollow = true; stick(true);
  await runTurn();
}

async function runTurn() {
  if (appState.ui.streaming || appState.ui.conversationLoading) return;
  const turnGeneration = appState.domain.conversationGeneration;
  const turnAbort = new AbortController();
  appState.ui.streaming = true; setSendStop(true); statusEl.textContent = "sta pensando…";
  appState.ui.currentAbort = turnAbort;
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
    if (finished || turnGeneration !== appState.domain.conversationGeneration) return; // niente render tardivi o su un'altra chat
    renderMD(body, acc);
    stick();
  };

  try {
    const res = await fetch("/api/chat", {
      method: "POST", headers: { "Content-Type": "application/json" },
      signal: turnAbort.signal,
      body: JSON.stringify({ messages: appState.domain.messages, model: appState.domain.currentModel, sessionId: appState.domain.sessionId, conversationId: appState.domain.conversationId, mode: appState.domain.mode, tutorMode: appState.domain.tutorMode || (appState.domain.stepMode ? "step" : null), dark: document.body.classList.contains("theme-dark") }),
    });
    if (!res.ok) throw new Error("HTTP " + res.status + ": " + (await res.text()).slice(0, 300));
    const reader = res.body.getReader();
    const dec = new TextDecoder();
    let buf = "";
    while (true) {
      const { done, value } = await reader.read();
      if (turnGeneration !== appState.domain.conversationGeneration) {
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
          if (/Appunti/i.test(data.text) && $("#kbDrawer") && !$("#kbDrawer").hidden && window.MathAppKb) window.MathAppKb.refresh(); // lista aggiornata se il pannello è aperto
        } else if (ev === "sympy_result") {
          const a2 = data.args || {};
          addCell(a2.operation, a2.expr || a2.vectors || a2.matrix || "", data.result, true);
          const r = data.result || {};
          if (r.ok) {
            const vb = document.createElement("div");
            vb.className = "vbadge";
            vb.textContent = "✓ verificato con SymPy — " + (a2.operation || "") + "(" + (a2.expr || a2.vectors || a2.matrix || "") + ") = " + String(r.result).slice(0, 140);
            bubble.appendChild(vb);
          } else showDetails();
        } else if (ev === "verification") {
          const hasMath = /\$|=|\\frac|\\sqrt/.test(acc);
          if (data.sympy || data.geogebra || hasMath) {
            const v = document.createElement("div");
            v.className = "vsum" + (data.sympy ? " ok" : " warn");
            v.title = "Conta i calcoli esatti eseguiti con SymPy in questa risposta. Controlla sempre che il testo riporti correttamente quei risultati.";
            v.textContent = data.sympy
              ? "✓ SymPy: " + data.sympy + " calcolo/i esatto/i"
              : (data.geogebra ? "Figura GeoGebra; nessun calcolo simbolico" : "Nessun calcolo simbolico in questa risposta");
            bubble.appendChild(v);
          }
        } else if (ev === "sources") {
          appState.ui.pendingSources = data; // mostrato a fine risposta, e solo se davvero ripreso
        } else if (ev === "usage") {
          appState.ui.usageTot.prompt += data.prompt || 0;
          appState.ui.usageTot.completion += data.completion || 0;
          appState.ui.usageTot.total += data.total || 0;
          const u = $("#usage");
          if (u) u.textContent = "tok " + appState.ui.usageTot.total.toLocaleString("it-IT");
        } else if (ev === "geogebra") {
          const cmds = data.commands || [];
          const fig = { fid: data.fid || crypto.randomUUID(), title: data.title || ("Figura " + (++appState.domain.figSeq)), commands: cmds.slice(), msgIdx: null, view: data.view === "3d" ? "3d" : "2d" };
          appState.domain.figures.push(fig);
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
            if (turnGeneration !== appState.domain.conversationGeneration) return;
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
    if (turnGeneration !== appState.domain.conversationGeneration) return;
    if (e && e.name === "AbortError") { acc += "\n\n*— interrotto —*"; }
    else { body.classList.add("err"); acc += "\n\n**Errore:** " + e.message; }
  }
  if (turnGeneration !== appState.domain.conversationGeneration) return;
  finished = true;
  renderMD(body, acc);
  think.style.display = "none";
  appState.domain.messages.push({ role: "assistant", content: acc });
  bubble.dataset.idx = appState.domain.messages.length - 1;
  const myIdx = Number(bubble.dataset.idx);
  for (const f of appState.domain.figures) if (f.msgIdx == null) f.msgIdx = myIdx;
  if (appState.domain.stepMode) applySteps(bubble, body);
  ensureFigureCards();
  placeFigureCards(bubble, body);
  renderSources(bubble, appState.ui.pendingSources, acc);
  appState.ui.pendingSources = null;
  addMsgActions(bubble, myIdx);
  saveState();
  appState.ui.streaming = false; setSendStop(false);
  if (appState.ui.currentAbort === turnAbort) appState.ui.currentAbort = null;
  statusEl.textContent = "";
  stick();
}

// ---------- modifica di un messaggio già inviato ----------
function startEdit(bubble) {
  if (appState.ui.streaming || appState.ui.conversationLoading) { flash("attendi il caricamento o la risposta in corso…"); return; }
  const idx = Number(bubble.dataset.idx);
  const msg = appState.domain.messages[idx];
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
  for (const f of appState.domain.figures) if (f.msgIdx != null && f.msgIdx >= idx) f.msgIdx = null; // riattacco dopo
  appState.domain.messages = appState.domain.messages.slice(0, idx);
  const um = { role: "user", content: newText };
  if (atts && atts.length) um.attachments = atts.slice();
  appState.domain.messages.push(um);
  const b = makeUserBubble(newText, atts);
  b.dataset.idx = idx;
  appState.ui.autoFollow = true; stick(true);
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
  if (appState.ui.conversationLoading && !allowDuringLoad) return;
  appState.domain.mode = m === "algebra" ? "algebra" : "figure";
  const isAlg = appState.domain.mode === "algebra";
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
  if (record !== false) { appState.domain.cellData.push({ op, expr, res, ai: !!fromAI }); index = appState.domain.cellData.length - 1; saveState(); }
  const n = (Number.isInteger(index) ? index : Math.max(0, appState.domain.cellData.length - 1)) + 1;
  const dataObj = record !== false ? appState.domain.cellData[appState.domain.cellData.length - 1] : (Number.isInteger(index) ? appState.domain.cellData[index] : null);

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
  const generation = appState.domain.conversationGeneration;
  let okN = 0;
  await enqueueGgbWork(generation, async () => {
    if (generation !== appState.domain.conversationGeneration) return false;
    setView3d(!!three, generation);
    try { ggbApplet.newConstruction(); applyGgbTheme(); } catch {}
    pushUndoPoint();
    const results = await applyCommands(cmds, generation);
    if (generation !== appState.domain.conversationGeneration) return false;
    okN = results.filter((r) => r.ok).length;
    if (!three && fitOpts) fitToContent(fitOpts);
    pushUndoPoint();
    return true;
  });
  if (generation !== appState.domain.conversationGeneration) return okN;
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
  const generation = appState.domain.conversationGeneration;
  let results = [];
  await enqueueGgbWork(generation, async () => {
    if (generation !== appState.domain.conversationGeneration) return false;
    pushUndoPoint();
    results = await applyCommands(cmds, generation);
    if (generation !== appState.domain.conversationGeneration) return false;
    if (fitOpts) fitToContent(fitOpts);
    pushUndoPoint();
    return true;
  });
  if (generation !== appState.domain.conversationGeneration) return results;
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
  const n = appState.domain.cellData.length;
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
        model: appState.domain.currentModel,
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
      del.addEventListener("click", (ev) => {
        ev.stopPropagation();
        MathAppState.dispatch("conversation.delete", { id: it.id }).catch((err) => console.warn("[MathApp] conversation.delete", err));
      });
      row.append(t, del);
      row.addEventListener("click", () => MathAppState.dispatch("conversation.open", { id: it.id }).catch((err) => console.warn("[MathApp] conversation.open", err)));
      list.appendChild(row);
    }
  } catch { list.innerHTML = '<div class="hist-empty">Cronologia non disponibile.</div>'; }
}
async function openConv(id) {
  const generation = invalidateConversationWork();
  const pendingWrites = stateWriteQueue;
  appState.ui.conversationLoading = true;
  sendBtn.disabled = true;
  statusEl.textContent = "carico argomento…";
  try {
    await pendingWrites;
    if (generation !== appState.domain.conversationGeneration) return;
    const r = await fetch("/api/conversation?id=" + encodeURIComponent(id));
    if (generation !== appState.domain.conversationGeneration) return;
    if (!r.ok) { flash("argomento non disponibile"); return; }
    const c = await r.json();
    if (generation !== appState.domain.conversationGeneration || !(await renderConversation(c, generation))) return;
    drawer.hidden = true;
    statusEl.textContent = "argomento ripreso";
    setTimeout(() => (statusEl.textContent = ""), 1500);
  } catch { if (generation === appState.domain.conversationGeneration) flash("errore nel caricamento dell'argomento"); }
  finally {
    if (generation === appState.domain.conversationGeneration) {
      appState.ui.conversationLoading = false;
      sendBtn.disabled = false;
      saveState();
    }
  }
}
function toggleHistory() {
  drawer.hidden = !drawer.hidden;
  if (!drawer.hidden) { refreshHistory(); refreshBackupInfo(); }
  return !drawer.hidden;
}
function closeHistory() { drawer.hidden = true; return false; }
$("#historyBtn").addEventListener("click", () => MathAppState.dispatch("history.toggle").catch((err) => console.warn("[MathApp] history.toggle", err)));
$("#historyClose").addEventListener("click", () => MathAppState.dispatch("history.close").catch((err) => console.warn("[MathApp] history.close", err)));

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
async function createBackup() {
  const b = $("#backupBtn");
  b.disabled = true; const old = b.textContent; b.textContent = "salvo…";
  try {
    const r = await (await fetch("/api/backup", { method: "POST" })).json();
    flash(r.ok ? "backup creato" : "backup non riuscito: " + (r.error || ""));
    return !!r.ok;
  } catch { flash("backup non riuscito"); return false; }
  finally { b.disabled = false; b.textContent = old; refreshBackupInfo(); }
}
$("#backupBtn").addEventListener("click", () => MathAppState.dispatch("backup.create").catch((err) => console.warn("[MathApp] backup.create", err)));

// ---------- allegati ----------
const MAX_FILE = 8 * 1024 * 1024, MAX_FILES = 4;

function fileIcon(a) {
  const mime = String(a.mime || ""), n = String(a.name || "");
  if (mime.startsWith("audio/") || /\.(mp3|wav|m4a|m4b|ogg|oga|opus|flac|webm|aac|wma)$/i.test(n)) return "🎵";
  if (mime.startsWith("image/")) return "🖼";
  if (mime.includes("pdf")) return "📕";
  return "📄";
}

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
  box.hidden = appState.ui.pending.length === 0;
  appState.ui.pending.forEach((a, i) => {
    const c = document.createElement("span"); c.className = "chip";
    const b = document.createElement("b"); b.textContent = fileIcon(a) + " " + a.name;
    const s = document.createElement("span"); s.textContent = fmtSize(a.size);
    const x = document.createElement("button"); x.type = "button"; x.textContent = "✕"; x.title = "Rimuovi";
    x.addEventListener("click", () => { appState.ui.pending.splice(i, 1); renderChips(); });
    c.append(b, s, x);
    box.appendChild(c);
  });
  // con una foto fra gli allegati: via rapida per farla risolvere passo passo
  if (appState.ui.pending.some((a) => String(a.mime || "").startsWith("image/"))) {
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
    if (appState.ui.pending.length >= MAX_FILES) { flash("massimo " + MAX_FILES + " allegati"); break; }
    if (f.size > MAX_FILE) { flash("«" + f.name + "» troppo grande (max 4 MB)"); continue; }
    const a = await readFile(f);
    if (a) appState.ui.pending.push(a);
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
  appState.domain.stateRevision = Math.max(Date.now(), appState.domain.stateRevision + 1, storedRevision + 1);
  try { localStorage.setItem("mathapp.stateRevision", String(appState.domain.stateRevision)); } catch {}
  return { id: appState.domain.conversationId, revision: appState.domain.stateRevision, ggb, cells: appState.domain.cellData, mode: appState.domain.mode, figures: appState.domain.figures, view3d: appState.domain.ggb3d, view: appState.domain.viewCustom };
}
function writeState(state) {
  const write = stateWriteQueue.catch(() => {}).then(() =>
    fetch("/api/conversation/state", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(state) }).catch(() => {})
  );
  stateWriteQueue = write;
  return write;
}
function saveState() {
  if (appState.ui.booting || appState.ui.conversationLoading) return;
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    saveTimer = null;
    const s = snapshot();
    writeState(s);
  }, 600);
}

function persistStateNow() {
  if (appState.ui.booting) return;
  clearTimeout(saveTimer);
  saveTimer = null;
  try {
    const s = snapshot(); // cattura qui l'id della chat corrente, prima di cambiarla
    return writeState(s);
  } catch {}
  return stateWriteQueue;
}

function invalidateConversationWork() {
  const generation = ++appState.domain.conversationGeneration;
  const wasLoading = appState.ui.conversationLoading;
  const controller = appState.ui.currentAbort;
  appState.ui.currentAbort = null;
  if (controller) { try { controller.abort(); } catch {} }
  appState.ui.streaming = false;
  appState.ui.conversationLoading = false;
  clearTimeout(saveTimer);
  saveTimer = null;
  setSendStop(false);
  statusEl.textContent = "";
  appState.ui.pendingSources = null;
  if (!wasLoading) persistStateNow();
  return generation;
}

async function renderConversation(conv, generation) {
  if (!conv || !conv.id || generation !== appState.domain.conversationGeneration) return false;
  ttsStop();
  if (Number.isSafeInteger(conv.stateRevision)) appState.domain.stateRevision = Math.max(appState.domain.stateRevision, conv.stateRevision);
  appState.domain.conversationId = String(conv.id);
  appState.domain.sessionId = appState.domain.conversationId;
  try {
    localStorage.setItem("mathapp.conv", appState.domain.conversationId);
    localStorage.removeItem("mathapp.empty");
  } catch {}

  appState.domain.messages = (Array.isArray(conv.messages) ? conv.messages : [])
    .filter((m) => m && (m.role === "user" || m.role === "assistant"))
    .map((m) => Object.assign({ role: m.role, content: m.content }, m.files && m.files.length ? { files: m.files } : {}));
  chatEl.replaceChildren();
  for (let i = 0; i < appState.domain.messages.length; i++) {
    try {
      const el = appendRendered(appState.domain.messages[i].role, appState.domain.messages[i].content, appState.domain.messages[i].files, i);
      if (appState.domain.messages[i].role === "assistant") addMsgActions(el, i); // copia · ascolta · ripasso anche a chat riaperte
    } catch (e) { console.warn("[MathApp] messaggio non ripristinato", e); }
  }

  appState.domain.cellData = Array.isArray(conv.cells) ? conv.cells.slice(-200) : [];
  calcCells.replaceChildren();
  for (let i = 0; i < appState.domain.cellData.length; i++) {
    try {
      const cellEl = addCell(appState.domain.cellData[i].op, appState.domain.cellData[i].expr, appState.domain.cellData[i].res, appState.domain.cellData[i].ai, false, i);
      if (cellEl && appState.domain.cellData[i].spiega && appState.domain.cellData[i].spiega.text) buildExplainBox(cellEl, appState.domain.cellData[i], appState.domain.cellData[i].spiega);
    } catch (e) { console.warn("[MathApp] cella non ripristinata", e); }
  }
  refreshCalcEmpty();
  calcHistory = appState.domain.cellData.slice().reverse().map((c) => c.expr).filter(Boolean).slice(0, 20);
  calcHistIdx = -1;

  appState.domain.figures = (Array.isArray(conv.figures) ? conv.figures : [])
    .filter((f) => f && f.fid != null)
    .slice(-60)
    .map((f) => ({
      fid: String(f.fid),
      title: String(f.title || "Figura"),
      commands: Array.isArray(f.commands) ? f.commands.slice(0, 200).map(String) : [],
      msgIdx: Number.isInteger(f.msgIdx) ? f.msgIdx : null,
      view: f.view === "3d" ? "3d" : "2d",
    }));
  appState.domain.figSeq = appState.domain.figures.length;
  for (const f of appState.domain.figures) {
    try {
      const host = f.msgIdx != null ? chatEl.querySelector('[data-idx="' + f.msgIdx + '"]') : null;
      renderFigureCard(host || chatEl, f, { collapsed: true });
    } catch (e) { console.warn("[MathApp] costruzione non ripristinata", e); }
  }
  refreshFigureList();
  appState.ui.pending = [];
  renderChips();
  appState.ui.pendingSources = null;
  appState.ui.usageTot = { prompt: 0, completion: 0, total: 0 };
  if ($("#usage")) $("#usage").textContent = "";

  try {
    const boardReady = await enqueueGgbWork(generation, async () => {
      if (generation !== appState.domain.conversationGeneration) return false;
      let restored = false;
      if (typeof conv.ggb === "string" && conv.ggb) {
        restored = await setGgbBase64Async(conv.ggb);
        if (generation !== appState.domain.conversationGeneration) return false;
        if (restored) applyGgbTheme();
      }
      if (!restored) {
        try { ggbApplet.newConstruction(); applyGgbTheme(); } catch {}
      }
      let nObj = 0;
      try { nObj = ggbApplet.getAllObjectNames().length; } catch {}
      if (!restored || !nObj) {
        const last = appState.domain.figures[appState.domain.figures.length - 1];
        if (last) {
          if (restored) ggbApplet.newConstruction();
          await applyCommands(last.commands, generation);
          if (generation !== appState.domain.conversationGeneration) return false;
          console.info("[MathApp] figura ricostruita da:", last.title);
        }
      }
      // orientamento 3D accumulato da un trascinamento impazzito: torna allo standard
      try {
        const m = ggbApplet.getXML().match(/<coordSystem[^>]*xAngle="([^"]+)" zAngle="([^"]+)"/);
        if (m && Math.abs(parseFloat(m[2])) > 3600) setView3dAngles(VIEW3D_STD);
      } catch {}
      return generation === appState.domain.conversationGeneration;
    });
    if (!boardReady || generation !== appState.domain.conversationGeneration) return false;
  } catch (e) { console.warn("[MathApp] ripristino figura", e); }

  if (generation !== appState.domain.conversationGeneration) return false;
  setView3d(conv.view3d === true, generation); // ripristina la vista 3D se era attiva
  appState.domain.viewCustom = null;
  appState.domain.viewCache = null;
  if (conv.view && typeof conv.view === "object") {
    const rec = { xmin: Number(conv.view.xmin), xmax: Number(conv.view.xmax), ymin: Number(conv.view.ymin), ymax: Number(conv.view.ymax), axes: conv.view.axes !== false, grid: conv.view.grid === true };
    if (viewFinite(rec)) {
      appState.domain.viewCustom = rec;
      if (!appState.domain.ggb3d) applyViewToBoard(rec);
    }
  }
  viewPanelSync();
  setMode(conv.mode === "algebra" ? "algebra" : "figure", true);
  if (generation !== appState.domain.conversationGeneration) return false;
  appState.ui.autoFollow = true;
  stick(true);
  return true;
}

window.addEventListener("beforeunload", () => {
  if (appState.ui.booting) return;
  try {
    const s = snapshot();
    navigator.sendBeacon("/api/conversation/state", new Blob([JSON.stringify(s)], { type: "application/json" }));
  } catch {}
});

async function restoreSession() {
  const generation = appState.domain.conversationGeneration;
  const stored = (() => { try { return localStorage.getItem("mathapp.conv"); } catch { return null; } })();
  let conv = null;
  if (stored) {
    try {
      const r = await fetch("/api/conversation?id=" + encodeURIComponent(stored));
      if (generation !== appState.domain.conversationGeneration) return;
      if (r.ok) conv = await r.json();
      else console.warn("[MathApp] sessione salvata non trovata:", stored);
    } catch (e) { console.warn("[MathApp] lettura sessione fallita", e); }
  }
  if (generation !== appState.domain.conversationGeneration) return;
  if (!conv && stored && (() => { try { return localStorage.getItem("mathapp.empty") !== "1"; } catch { return true; } })()) {
    // rete di sicurezza: la sessione salvata non esiste piu' -> recupero la piu' recente
    try {
      const h = await (await fetch("/api/history")).json();
      if (generation !== appState.domain.conversationGeneration) return;
      if (h.items && h.items.length) {
        const r2 = await fetch("/api/conversation?id=" + encodeURIComponent(h.items[0].id));
        if (generation !== appState.domain.conversationGeneration) return;
        if (r2.ok) { conv = await r2.json(); flash("ripristinata la sessione più recente"); }
      }
    } catch (e) { console.warn("[MathApp] recupero sessione recente fallito", e); }
  }
  if (!conv) { try { localStorage.removeItem("mathapp.conv"); } catch {} return; }
  if (generation !== appState.domain.conversationGeneration || !(await renderConversation(conv, generation))) return;
  const n = appState.domain.messages.length + appState.domain.cellData.length + appState.domain.figures.length;
  if (n) flash("sessione ripristinata (" + n + " elementi)");
}

// ---------- UI ----------
async function sendCommand(payload) {
  if (appState.ui.streaming) { flash("attendi la risposta in corso oppure interrompila con Ferma."); return; }
  const t = String(payload && payload.text || "").trim();
  if (!t) return;
  inputEl.value = "";
  await send(t);
}
MathAppState.handle("chat.send", sendCommand);
$("#composer").addEventListener("submit", (e) => {
  e.preventDefault();
  MathAppState.dispatch("chat.send", { text: inputEl.value }).catch((err) => console.warn("[MathApp] chat.send", err));
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
async function newChatCommand() {
const generation = invalidateConversationWork();
  ttsStop();
  appState.domain.messages = []; appState.domain.sessionId = crypto.randomUUID(); appState.domain.conversationId = crypto.randomUUID();
  chatEl.replaceChildren(); calcCells.replaceChildren(); appState.domain.cellData = [];
  refreshCalcEmpty();
  const welcome = $("#chatWelcome"); if (welcome) welcome.hidden = false;
  appState.domain.figures = []; appState.domain.figSeq = 0; refreshFigureList(); // BUG FIX: le costruzioni non si trascinano nella nuova chat
  try { localStorage.setItem("mathapp.conv", appState.domain.conversationId); localStorage.setItem("mathapp.empty", "1"); } catch {}
  appState.ui.pending = []; renderChips();
  appState.ui.usageTot = { prompt: 0, completion: 0, total: 0 };
  if ($("#usage")) $("#usage").textContent = "";
  queueGgbClear(generation);
  setView3d(false, generation);
  appState.domain.viewCustom = null;
  appState.domain.viewCache = null;
  setViewPanel(false);
  statusEl.textContent = "nuova chat";
  setTimeout(() => (statusEl.textContent = ""), 1200);
}
MathAppState.handle("session.new", newChatCommand);
$("#newChat").addEventListener("click", () => MathAppState.dispatch("session.new").catch((err) => console.warn("[MathApp] session.new", err)));

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

// La lettura ad alta voce e' un plugin: qui restano solo gli stub usati dal core.
let ttsApi = null;
async function ensureTTS() {
  if (!window.MathAppPlugins) return null;
  ttsApi = await window.MathAppPlugins.load("tts");
  return ttsApi;
}
function ttsStop() { if (ttsApi) ttsApi.stop(); }

function stopStreaming() { if (appState.ui.currentAbort) { try { appState.ui.currentAbort.abort(); } catch {} } ttsStop(); }

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
  for (const f of appState.domain.figures) {
    if (chatEl.querySelector('.ggb-card[data-fid="' + f.fid + '"]')) continue;
    const host = f.msgIdx != null ? chatEl.querySelector('[data-idx="' + f.msgIdx + '"]') : null;
    renderFigureCard(host || chatEl, f, { collapsed: true });
  }
}

async function regenerate() {
  if (appState.ui.streaming || appState.ui.conversationLoading) { flash("attendi il caricamento o la risposta in corso…"); return; }
  const last = appState.domain.messages[appState.domain.messages.length - 1];
  if (!last || last.role !== "assistant") { flash("niente da rigenerare"); return; }
  const idx = appState.domain.messages.length - 1;
  appState.domain.messages.pop();
  const el = chatEl.querySelector('.msg.assistant[data-idx="' + idx + '"]');
  if (el) el.remove();
  for (const f of appState.domain.figures) if (f.msgIdx === idx) f.msgIdx = null; // le schede verranno riattaccate
  appState.ui.autoFollow = true; stick(true);
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
  bar.appendChild(mkBtn("⧉ Copia", () => copyText((appState.domain.messages[idx] || {}).content, "risposta copiata in Markdown")));
  if ((appState.domain.messages[idx] || {}).role === "assistant" && appState.domain.messages[idx].content) {
    const tts = mkBtn("Ascolta", async (ev) => {
      const api = await ensureTTS();
      if (!api) { flash("lettura non disponibile"); return; }
      api.speak(appState.domain.messages[idx].content, ev.currentTarget);
    });
    tts.classList.add("tts-btn");
    bar.appendChild(tts);
  }
  if (idx === appState.domain.messages.length - 1) bar.appendChild(mkBtn("↻ Rigenera", () => regenerate()));
  const starBtn = mkBtn("Ripasso", async () => {
    const firstUser = (appState.domain.messages.find((m) => m.role === "user") || {}).content || "Argomento";
    starBtn.disabled = true;
    try {
      const review = await ensureReview();
      if (!review) { starBtn.disabled = false; flash("Ripasso non disponibile"); return; }
      const j = await review.add({ convId: appState.domain.conversationId, title: firstUser, text: (appState.domain.messages[idx] || {}).content || "" });
      starBtn.textContent = "Salvato";
      flash(j && j.existing ? "gia' nel Ripasso" : "aggiunto al Ripasso");
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
  appState.domain.tutorMode = mode === "socratic" ? "socratic" : null;
  appState.domain.stepMode = mode === "step";
  try {
    localStorage.setItem("mathapp.socratic", appState.domain.tutorMode ? "1" : "");
    localStorage.setItem("mathapp.step", appState.domain.stepMode ? "1" : "");
  } catch {}
  const sb = $("#socraticBtn"), stb = $("#stepBtn");
  if (sb) { sb.classList.toggle("is-active", !!appState.domain.tutorMode); sb.setAttribute("aria-pressed", String(!!appState.domain.tutorMode)); }
  if (stb) { stb.classList.toggle("is-active", appState.domain.stepMode); stb.setAttribute("aria-pressed", String(appState.domain.stepMode)); }
  const hint = $("#modeHint");
  if (hint) {
    hint.hidden = !appState.domain.tutorMode && !appState.domain.stepMode;
    const label = hint.querySelector("span");
    if (label) {
      label.textContent = appState.domain.tutorMode
        ? "🎓 Esercitami attivo: il tutor ti guida con domande, senza darti la soluzione."
        : "🪜 Passo-passo attivo: la risposta si rivela un blocco alla volta.";
    }
  }
}
function toggleTutor(mode) {
  const on = mode === "socratic" ? appState.domain.tutorMode !== "socratic" : !appState.domain.stepMode;
  applyTutorMode(on ? mode : null);
  flash(on ? (mode === "socratic" ? "Esercitami: il tutor ti guida con domande" : "Passo-passo: le risposte si rivelano un passo alla volta") : "modalità spiegazione normale");
  return on ? mode : null;
}
$("#socraticBtn").addEventListener("click", () => MathAppState.dispatch("tutor.toggle", { mode: "socratic" }).catch((err) => console.warn("[MathApp] tutor.toggle", err)));
$("#stepBtn").addEventListener("click", () => MathAppState.dispatch("tutor.toggle", { mode: "step" }).catch((err) => console.warn("[MathApp] tutor.toggle", err)));
$("#modeHintExit").addEventListener("click", () => MathAppState.dispatch("tutor.off").catch((err) => console.warn("[MathApp] tutor.off", err)));

function toggleTheme() {
  const dark = !document.body.classList.contains("theme-dark");
  document.body.classList.toggle("theme-dark", dark);
  try { localStorage.setItem("mathapp.dark", dark ? "1" : ""); } catch {}
  applyGgbTheme();
  return dark;
}
$("#themeBtn").addEventListener("click", () => MathAppState.dispatch("theme.toggle").catch((err) => console.warn("[MathApp] theme.toggle", err)));

// mentre l'IA risponde il pulsante Invia è "Ferma": clic = interrompi (senza inviare)
$("#send").addEventListener("click", (e) => { if (appState.ui.streaming) { e.preventDefault(); MathAppState.dispatch("chat.stop").catch((err) => console.warn("[MathApp] chat.stop", err)); } });

// ---------- ripasso (scadenze SM-2 + export Anki) ----------
const itDue = (it) => (typeof it.due === "number" ? it.due : (Number(it.t) || 0));
const isDue = (it) => itDue(it) <= Date.now();

let reviewApi = null;
async function ensureReview() {
  if (!window.MathAppPlugins) return null;
  reviewApi = await window.MathAppPlugins.load("review");
  return reviewApi;
}
function refreshReviewBadge() { if (reviewApi) reviewApi.refreshBadge(); }

// ---------- ricerca nella cronologia ----------
let histTimer = null;
$("#historySearch").addEventListener("input", (e) => { clearTimeout(histTimer); histTimer = setTimeout(() => MathAppState.dispatch("history.search", { q: e.target.value }).catch((err) => console.warn("[MathApp] history.search", err)), 250); });

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
  const title = ((appState.domain.messages.find((m) => m.role === "user") || {}).content || "Sessione MathApp").slice(0, 80);
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
  if (!cells || !appState.domain.cellData.length) { flash("il quaderno è vuoto: niente da esportare"); return; }
  const css = await fetch("/style.css").then((r) => r.text()).catch(() => "");
  const title = ((appState.domain.messages.find((m) => m.role === "user") || {}).content || "Quaderno MathApp").slice(0, 80);
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
  const title = ((appState.domain.messages.find((m) => m.role === "user") || {}).content || "Sessione MathApp").slice(0, 100);
  const lines = ["# " + title, "", "_Esportato il " + new Date().toLocaleString("it-IT") + "_", ""];
  for (const m of appState.domain.messages) lines.push(m.role === "user" ? "## Domanda" : "## Risposta", "", m.content || "", "");
  if (appState.domain.cellData.length) {
    lines.push("## Calcoli (quaderno)", "");
    for (const c of appState.domain.cellData) lines.push("- `" + (c.op || "") + " " + (c.expr || "") + "` = `" + String((c.res && c.res.result) || "") + "`");
  }
  if (appState.domain.figures.length) {
    lines.push("", "## Costruzioni GeoGebra", "");
    appState.domain.figures.forEach((f, i) => lines.push((i + 1) + ". **" + (f.title || "figura") + "** — " + (f.commands || []).length + " comandi"));
  }
  const blob = new Blob([lines.join("\n")], { type: "text/markdown;charset=utf-8" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = "mathapp-sessione.md";
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 4000);
  flash("Markdown scaricato");
}
$("#exportPdf").addEventListener("click", () => MathAppState.dispatch("export.pdf").catch((err) => console.warn("[MathApp] export.pdf", err)));
$("#exportMd").addEventListener("click", () => MathAppState.dispatch("export.markdown").catch((err) => console.warn("[MathApp] export.markdown", err)));
$("#calcPdf").addEventListener("click", () => MathAppState.dispatch("export.notebook").catch((err) => console.warn("[MathApp] export.notebook", err)));

// ---------- scorciatoie da tastiera ----------
window.addEventListener("keydown", (e) => {
  if (e.key === "Escape" && appState.ui.streaming) { stopStreaming(); return; }
  const ctrl = e.ctrlKey || e.metaKey;
  const inField = e.target && e.target.closest && e.target.closest("input, textarea, [contenteditable]");
  if (ctrl && !inField && e.key.toLowerCase() === "z" && !e.shiftKey) { e.preventDefault(); boardUndo(); return; }
  if (ctrl && !inField && (e.key.toLowerCase() === "y" || (e.shiftKey && e.key.toLowerCase() === "z"))) { e.preventDefault(); boardRedo(); return; }
  if (ctrl && e.key.toLowerCase() === "k") { e.preventDefault(); setMode("figure"); inputEl.focus(); return; }
  if (e.altKey && e.key.toLowerCase() === "n") { e.preventDefault(); $("#newChat").click(); return; }
  if (e.altKey && e.key.toLowerCase() === "r") { e.preventDefault(); MathAppState.dispatch("chat.regenerate").catch((err) => console.warn("[MathApp] chat.regenerate", err)); return; }
  if (e.key === "ArrowUp" && document.activeElement === inputEl && !inputEl.value.trim()) {
    const u = [...appState.domain.messages].reverse().find((m) => m.role === "user");
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

function applyMode(mode) {
  document.body.classList.toggle("mode-core", mode !== "full");
}

async function loadDiagnostics() {
  const el = $("#diagStatus");
  if (!el) return;
  try {
    const r = await fetch("/api/diagnostics");
    const d = await r.json();
    el.textContent = "Node " + d.node + " | Python " + (d.python || "no") + " | SymPy " + (d.sympy || "no") + " | PDF " + (d.pypdf || "no") + " | Whisper " + (d.whisper ? "ok" : "no") + " | provider " + d.provider + (d.hasKey ? " (key ok)" : " (no key)") + " | data " + (d.dataDirOk ? "ok" : "KO") + " | backup " + (d.backupDirOk ? "ok" : "KO") + " | porta " + d.port + " | modo " + (d.mode === "full" ? "completo" : "essenziale");
  } catch { el.textContent = "diagnostica non disponibile"; }
}

async function loadSettings() {
  try { const r = await fetch("/api/settings"); appState.ui.settingsData = await r.json(); } catch { appState.ui.settingsData = null; }
  const d = appState.ui.settingsData;
  if (!d || !d.ok) return;
  applyMode(d.mode || "core");
  const modeSel = $("#setMode"); if (modeSel) modeSel.value = d.mode || "core";
  const levelSel = $("#setLevel"); if (levelSel) levelSel.value = d.level || "auto";
  if ((d.mode || "core") === "full" && window.MathAppPlugins) {
    for (const id of ["quiz", "review", "tts", "kb", "style"]) window.MathAppPlugins.load(id).catch((e) => console.warn("[MathApp] " + id + " plugin", e));
  }
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
  const levelEl = $("#setLevel"); if (levelEl) body.level = levelEl.value;
  const k = $("#setKey").value.trim();
  if (k) body.apiKey = k;
  try {
    const r = await fetch("/api/settings", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    const j = await r.json();
    if (!j.ok) { if (msg) msg.textContent = "Errore: " + (j.err || "salvataggio fallito"); return; }
    if (msg) msg.textContent = "Salvato.";
    if (j.model) { appState.domain.currentModel = j.model; if (modelEl) modelEl.value = j.model; }
    if (j.mode) { applyMode(j.mode); const ms = $("#setMode"); if (ms) ms.value = j.mode; }
    if (j.level) { const ls = $("#setLevel"); if (ls) ls.value = j.level; }
    await loadSettings();
    try {
      const mr = await fetch("/api/models"); const mj = await mr.json();
      const vis = mj.vision || {};
      modelEl.innerHTML = mj.models.map((m) => `<option value="${m}">${m}${vis[m] === false ? " (solo testo)" : ""}</option>`).join("");
      appState.domain.currentModel = mj.default || appState.domain.currentModel;
      modelEl.value = appState.domain.currentModel;
    } catch {}
  } catch (e) { if (msg) msg.textContent = "Errore di rete"; }
}

function initSettingsUI() {
  const d = $("#settingsDrawer"); if (!d) return;
  const chatWelcome = $("#chatWelcome");
  if (chatWelcome) chatWelcome.addEventListener("click", (e) => {
    const q = e.target.closest("[data-q]");
    if (!q) return;
    inputEl.value = q.dataset.q;
    inputEl.focus();
  });
  MathAppState.handle("settings.open", async () => { const el = $("#settingsDrawer"); if (!el) return false; el.hidden = false; await loadSettings(); return true; });
MathAppState.handle("settings.toggle", async () => { const el = $("#settingsDrawer"); if (!el) return false; el.hidden = !el.hidden; if (!el.hidden) await loadSettings(); return !el.hidden; });
MathAppState.handle("settings.save", (payload) => saveSettings(payload || {}));
MathAppState.handle("settings.clearKey", () => saveSettings({ clearKey: true }));
MathAppState.handle("view.mode", ({ mode }) => setMode(mode === "algebra" ? "algebra" : "figure"));
MathAppState.handle("chat.stop", () => stopStreaming());
MathAppState.handle("chat.regenerate", () => regenerate());


$("#settingsBtn").addEventListener("click", () => { MathAppState.dispatch("settings.toggle").catch((e) => console.warn("[MathApp] settings.toggle", e)); });
  $("#settingsClose").addEventListener("click", () => MathAppState.dispatch("settings.close").catch((err) => console.warn("[MathApp] settings.close", err)));
  const so = $("#setupOpen"); if (so) so.addEventListener("click", () => { MathAppState.dispatch("settings.open").catch((e) => console.warn("[MathApp] settings.open", e)); });
  $("#settingsSave").addEventListener("click", () => { MathAppState.dispatch("settings.save").catch((e) => console.warn("[MathApp] settings.save", e)); });
  $("#settingsClearKey").addEventListener("click", () => { MathAppState.dispatch("settings.clearKey").catch((e) => console.warn("[MathApp] settings.clearKey", e)); });
  const dr = $("#diagRefresh"); if (dr) dr.addEventListener("click", () => MathAppState.dispatch("diagnostics.refresh").catch((err) => console.warn("[MathApp] diagnostics.refresh", err)));
}

initSettingsUI();

MathAppState.handle("settings.close", () => { const el = $("#settingsDrawer"); if (el) el.hidden = true; return false; });
MathAppState.handle("theme.toggle", toggleTheme);
MathAppState.handle("tutor.toggle", ({ mode }) => toggleTutor(mode === "socratic" ? "socratic" : "step"));
MathAppState.handle("tutor.off", () => { applyTutorMode(null); flash("modalità spiegazione normale"); return null; });
MathAppState.handle("view.toggle3d", toggleView3d);
MathAppState.handle("history.toggle", toggleHistory);
MathAppState.handle("history.close", closeHistory);
MathAppState.handle("history.search", async ({ q }) => { const el = $("#historySearch"); if (el && typeof q === "string") el.value = q; await refreshHistory(); return true; });
MathAppState.handle("conversation.open", ({ id }) => openConv(id));
MathAppState.handle("conversation.delete", async ({ id }) => {
  if (!id) return false;
  await fetch("/api/conversation?id=" + encodeURIComponent(id), { method: "DELETE" });
  await refreshHistory();
  return true;
});
MathAppState.handle("backup.create", createBackup);
MathAppState.handle("export.pdf", exportPdf);
MathAppState.handle("export.markdown", exportMarkdown);
MathAppState.handle("export.notebook", exportNotebookPdf);
MathAppState.handle("diagnostics.refresh", loadDiagnostics);
MathAppState.handle("model.select", ({ model }) => {
  if (typeof model !== "string" || !model) return appState.domain.currentModel;
  appState.domain.currentModel = model;
  if (modelEl) modelEl.value = model;
  return model;
});

MathAppState.handle("session.restore", () => restoreSession());

window.MathAppApp = { $, flash, mkBtn, renderMD, fmtDate, openConv, b64FromBlob, refreshReviewBadge, state: appState };

async function boot() {
  initGGB();
  setMode("figure");
  initPreferences();
  setTimeout(() => { try { applyGgbTheme(); } catch {} }, 1500);
  try {
    const r = await fetch("/api/models"); const j = await r.json();
    const vis = j.vision || {};
    modelEl.innerHTML = j.models.map((m) => `<option value="${m}">${m}${vis[m] === false ? " · solo testo" : ""}</option>`).join("");
    appState.domain.currentModel = j.default || appState.domain.currentModel; modelEl.value = appState.domain.currentModel;
    modelEl.addEventListener("change", () => MathAppState.dispatch("model.select", { model: modelEl.value }).catch((err) => console.warn("[MathApp] model.select", err)));
  } catch { modelEl.innerHTML = `<option>${appState.domain.currentModel}</option>`; }
  await loadSettings();
  await MathAppState.dispatch("session.restore");
  try { if (!localStorage.getItem("mathapp.conv")) localStorage.setItem("mathapp.conv", appState.domain.conversationId); } catch {}
  appState.ui.booting = false;
  refreshReviewBadge();
}
window.addEventListener("DOMContentLoaded", boot);
