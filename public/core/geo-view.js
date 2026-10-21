// Finestra 2D di GeoGebra: lettura della vista, applicazione, pannello e "Adatta".
// L'applet resta di proprieta' di app.js: qui arrivano solo getter e dipendenze.
(function () {
  "use strict";

  function create(deps) {
    const { appState, $, flash, saveState, fmtViewNum, getApplet, isReady } = deps;
    const viewPanel = $("#viewPanel");

    function viewFinite(v) {
      return !!v && [v.xmin, v.xmax, v.ymin, v.ymax].every((n) => Number.isFinite(n)) && v.xmin < v.xmax && v.ymin < v.ymax;
    }

    function viewFromBoard() {
      if (!isReady()) return appState.domain.viewCache;
      try {
        const xml = getApplet().getXML();
        const block = (xml.match(/<euclidianView>[\s\S]*?<\/euclidianView>/) || [""])[0];
        if (!block) return appState.domain.viewCache;
        const tag = (re) => (block.match(re) || [""])[0];
        const num = (t, name) => {
          const m = String(t).match(new RegExp("\\b" + name + '="([^"]+)"'));
          return m ? parseFloat(m[1]) : NaN;
        };
        const flag = (t, name) => {
          const m = String(t).match(new RegExp("\\b" + name + '="([^"]+)"'));
          return m ? m[1] === "true" : null;
        };
        const sizeTag = tag(/<size [^>]*>/), csTag = tag(/<coordSystem [^>]*>/), evTag = tag(/<evSettings [^>]*>/);
        const W = num(sizeTag, "width"), H = num(sizeTag, "height");
        const x0 = num(csTag, "xZero"), y0 = num(csTag, "yZero"), sx = num(csTag, "scale"), sy = num(csTag, "yscale");
        if (![W, H, x0, y0, sx, sy].every(Number.isFinite) || sx <= 0 || sy <= 0) return appState.domain.viewCache;
        const rec = {
          xmin: -x0 / sx,
          xmax: (W - x0) / sx,
          ymin: (y0 - H) / sy,
          ymax: y0 / sy,
          axes: flag(evTag, "axes"),
          grid: flag(evTag, "grid"),
        };
        if (viewFinite(rec)) {
          appState.domain.viewCache = rec;
          return rec;
        }
        return appState.domain.viewCache;
      } catch {
        return appState.domain.viewCache;
      }
    }

    function applyViewToBoard(rec) {
      if (!isReady() || appState.domain.ggb3d || !viewFinite(rec)) return false;
      const applet = getApplet();
      let done = false;
      try {
        applet.setCoordSystem(rec.xmin, rec.xmax, rec.ymin, rec.ymax);
        done = true;
      } catch (e) {
        console.warn("[MathApp] setCoordSystem non riuscito", e);
      }
      if (!done) {
        try {
          applet.evalCommand("ZoomIn(" + fmtViewNum(rec.xmin) + "," + fmtViewNum(rec.ymin) + "," + fmtViewNum(rec.xmax) + "," + fmtViewNum(rec.ymax) + ")");
          done = true;
        } catch {}
      }
      if (!done) return false;
      appState.domain.viewCache = rec;
      try {
        if (typeof rec.axes === "boolean" && applet.setAxesVisible) applet.setAxesVisible(rec.axes, rec.axes);
      } catch {}
      try {
        if (typeof rec.grid === "boolean" && applet.setGridVisible) applet.setGridVisible(rec.grid);
      } catch {}
      return true;
    }

    function viewPanelSync() {
      const cur = viewFromBoard() || appState.domain.viewCustom;
      const base = cur || { xmin: -10, xmax: 10, ymin: -10, ymax: 10 };
      const set = (id, v) => {
        const el = $(id);
        if (el) el.value = fmtViewNum(v);
      };
      set("#vxmin", base.xmin);
      set("#vxmax", base.xmax);
      set("#vymin", base.ymin);
      set("#vymax", base.ymax);
      const ax = $("#vaxes"), gr = $("#vgrid");
      if (ax) ax.checked = cur && cur.axes !== null && cur.axes !== undefined ? !!cur.axes : true;
      if (gr) gr.checked = !!(cur && cur.grid);
    }

    function applyView(rec, persist) {
      if (appState.domain.ggb3d) {
        flash("la finestra vale per il piano 2D: prima esci dalla vista 3D");
        return false;
      }
      if (!applyViewToBoard(rec)) {
        flash("finestra non applicata");
        return false;
      }
      appState.domain.viewCustom = rec;
      viewPanelSync();
      if (persist !== false) saveState();
      return true;
    }

    function setViewPanel(open) {
      if (!viewPanel) return;
      viewPanel.hidden = !open;
      const b = $("#viewBtn");
      if (b) {
        b.classList.toggle("is-on", !!open);
        b.setAttribute("aria-expanded", String(!!open));
      }
      if (open) viewPanelSync();
    }

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
      if (lastFig) {
        for (const c of lastFig.commands) {
          const m = String(c).match(/^\s*[A-Za-z][\w']*\s*=\s*\(\s*(-?[\d.]+)\s*,\s*(-?[\d.]+)\s*[,)]/);
          if (m) pts.push({ x: parseFloat(m[1]), y: parseFloat(m[2]) });
        }
      }
      const lastDraw = latestDrawCell();
      if (lastDraw && lastDraw.draw && Array.isArray(lastDraw.draw.punti)) {
        for (const p of lastDraw.draw.punti) {
          const x = Number(p.x), y = Number(p.y);
          if (Number.isFinite(x) && Number.isFinite(y)) pts.push({ x, y });
        }
      }
      return pts;
    }

    // Campiona f(x) facendo calcolare il valore a GeoGebra (variabile temporanea zzFit).
    function sampleFnY(name, x) {
      const applet = getApplet();
      try {
        if (!applet.evalCommand("zzFit = " + name + "(" + fmtViewNum(x) + ")")) return null;
        const v = Number(applet.getValue("zzFit"));
        return Number.isFinite(v) ? v : null;
      } catch {
        return null;
      }
    }

    function fitToContent(opts) {
      if (!isReady() || appState.domain.ggb3d) return false;
      const applet = getApplet();
      const pts = collectFitPoints().concat((opts && opts.points) || []);
      const fns = ((opts && opts.functions) || []).slice();
      const lastFig = appState.domain.figures[appState.domain.figures.length - 1];
      if (lastFig) {
        for (const c of lastFig.commands) {
          const m = String(c).match(/^\s*([A-Za-z]\w*)\s*\(x\)\s*=/);
          if (m) fns.push(m[1]);
        }
      }
      const lastDraw = latestDrawCell();
      if (lastDraw && lastDraw.kind === "studio" && lastDraw.draw && lastDraw.draw.funzione) fns.push("f");
      const cur = viewFromBoard();
      let xmin = Infinity, xmax = -Infinity;
      for (const p of pts) {
        if (p.x < xmin) xmin = p.x;
        if (p.x > xmax) xmax = p.x;
      }
      if (Number.isFinite(xmin)) {
        if (xmax - xmin < 1e-9) {
          const c0 = (xmin + xmax) / 2 || 0;
          xmin = c0 - 2;
          xmax = c0 + 2;
        }
        const padX = Math.min(Math.max(0.35 * (xmax - xmin), 1), 50);
        xmin -= padX;
        xmax += padX;
      } else if (fns.length && cur) {
        xmin = cur.xmin;
        xmax = cur.xmax;
      } else {
        return false;
      }
      const ys = [];
      for (const p of pts) if (Number.isFinite(p.y) && Math.abs(p.y) < 1e6) ys.push(p.y);
      if (fns.length) {
        let names = [];
        try { names = applet.getAllObjectNames(); } catch {}
        const valid = fns.filter((nm, i) => names.includes(nm) && fns.indexOf(nm) === i);
        if (valid.length && !names.includes("zzFit")) {
          for (const nm of valid) {
            for (let i = 0; i <= 120; i++) {
              const y = sampleFnY(nm, xmin + ((xmax - xmin) * i) / 120);
              if (y !== null && Math.abs(y) < 1e6) ys.push(y);
            }
          }
          try { applet.deleteObject("zzFit"); } catch {}
        }
      }
      if (!ys.length) return false;
      ys.sort((a, b) => a - b);
      const pick = (q) => ys[Math.min(ys.length - 1, Math.max(0, Math.floor(q * (ys.length - 1))))];
      let ymin = pick(0.02), ymax = pick(0.98);
      if (!(ymax > ymin)) {
        ymin = ys[0];
        ymax = ys[ys.length - 1];
      }
      if (ymax - ymin < 1e-9) {
        const c1 = (ymin + ymax) / 2 || 0;
        ymin = c1 - 2;
        ymax = c1 + 2;
      }
      const padY = 0.1 * (ymax - ymin);
      const base = appState.domain.viewCustom || cur || { axes: true, grid: false };
      return applyView({ xmin, xmax, ymin: ymin - padY, ymax: ymax + padY, axes: base.axes !== false, grid: base.grid === true });
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
        const rec = {
          xmin: num("#vxmin"),
          xmax: num("#vxmax"),
          ymin: num("#vymin"),
          ymax: num("#vymax"),
          axes: $("#vaxes").checked,
          grid: $("#vgrid").checked,
        };
        if (!viewFinite(rec)) {
          flash("controlla gli intervalli: il minimo dev'essere minore del massimo");
          return;
        }
        if (applyView(rec)) flash("finestra applicata");
      });
      $("#viewStd").addEventListener("click", () => {
        if (applyView({ xmin: -10, xmax: 10, ymin: -10, ymax: 10, axes: true, grid: false })) flash("finestra standard");
      });
      $("#viewFit").addEventListener("click", () => {
        if (!fitToContent()) flash("niente da inquadrare: disegna prima una funzione o dei punti");
      });
    }

    return { viewFinite, viewFromBoard, applyViewToBoard, viewPanelSync, setViewPanel, fitToContent };
  }

  window.MathAppGeoView = { create };
})();
