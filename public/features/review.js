// Plugin UI opzionale: Ripasso / SM-2.
(function () {
  MathAppPlugins.register("review", function init(app) {
    const $ = app.$;
    const flash = app.flash;
    const mkBtn = app.mkBtn;
    const renderMD = app.renderMD;
    const fmtDate = app.fmtDate;
    const openConv = app.openConv;
    const itDue = (it) => (typeof it.due === "number" ? it.due : (Number(it.t) || 0));
    const isDue = (it) => itDue(it) <= Date.now();

    async function refreshBadge() {
      const b = $("#reviewBadge");
      if (!b) return;
      try {
        const j = await (await fetch("/api/review")).json();
        const n = (j.items || []).filter(isDue).length;
        b.textContent = String(n);
        b.hidden = !n;
      } catch { b.hidden = true; }
    }

    async function grade(it, q) {
      try {
        const r = await (await fetch("/api/review/grade", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id: it.id, q }) })).json();
        if (!r.ok) { flash("ripasso: " + (r.error || "non riuscito")); return; }
        const nu = r.item || {};
        flash(q === "difficile" ? "la rivedrai fra 10 minuti" : "prossimo ripasso fra " + nu.interval + (nu.interval === 1 ? " giorno" : " giorni"));
        refresh();
        refreshBadge();
      } catch { flash("ripasso: errore di rete"); }
    }

    async function refresh() {
      const list = $("#reviewList");
      const counter = $("#reviewCount");
      try {
        const j = await (await fetch("/api/review")).json();
        const items = (j.items || []).slice().sort((a, b) => itDue(a) - itDue(b));
        const n = items.length;
        const nDue = items.filter(isDue).length;
        if (counter) counter.textContent = n === 0 ? "nessun argomento salvato" : (nDue ? nDue + " da ripassare oggi — " + n + " in tutto" : n + " in tutto — nessuno in scadenza");
        const badge = $("#reviewBadge");
        if (badge) { badge.textContent = String(nDue); badge.hidden = !nDue; }
        if (!n) {
          list.innerHTML = '<div class="hist-empty">Nessun argomento da ripassare.<br>Premi <b>Ripasso</b> sotto una risposta per ritrovarla qui.</div>';
          return;
        }
        list.innerHTML = "";
        for (const it of items) {
          const due = isDue(it);
          const row = document.createElement("div"); row.className = "rev-item" + (due ? " rev-due" : "");
          const title = document.createElement("b"); title.className = "rev-title";
          title.textContent = (it.type === "flashcard" ? "Flashcard · " : "") + (it.title || "Argomento").slice(0, 120);
          const meta = document.createElement("i"); meta.className = "rev-meta";
          meta.textContent = fmtDate(it.t) + (due ? " — da ripassare oggi" : " — prossimo ripasso " + new Date(itDue(it)).toLocaleDateString("it-IT", { day: "2-digit", month: "short" }) + (it.interval ? " (fra " + it.interval + (it.interval === 1 ? " giorno" : " giorni") + ")" : ""));
          const text = document.createElement("div"); text.className = "rev-text";
          renderMD(text, String(it.text || "").trim());
          const actions = document.createElement("div"); actions.className = "rev-actions";
          actions.append(
            mkBtn("Difficile", () => grade(it, "difficile"), "rev-g rev-g1"),
            mkBtn("Media", () => grade(it, "media"), "rev-g rev-g2"),
            mkBtn("Facile", () => grade(it, "facile"), "rev-g rev-g3"),
          );
          if (it.convId && !String(it.convId).startsWith("kb:")) {
            actions.append(mkBtn("Apri sessione", async () => { $("#reviewDrawer").hidden = true; await openConv(it.convId); }, "rev-open"));
          }
          const expand = mkBtn("Mostra risposta", () => {
            const open = !row.classList.contains("open");
            row.classList.toggle("open", open);
            expand.textContent = open ? "Nascondi risposta" : "Mostra risposta";
          });
          const del = mkBtn("Elimina", async (ev) => {
            ev.stopPropagation();
            if (!confirm("Togliere \"" + String(it.title || "questo argomento").slice(0, 60) + "\" dal Ripasso?")) return;
            await fetch("/api/review?id=" + encodeURIComponent(it.id), { method: "DELETE" });
            refresh();
            refreshBadge();
          }, "hist-del");
          actions.append(expand, del);
          row.append(title, meta, text, actions);
          list.appendChild(row);
        }
      } catch { list.innerHTML = '<div class="hist-empty">Ripasso non disponibile.</div>'; }
    }

    function ankiCsv(items) {
      const esc = (s) => '"' + String(s || "").replace(/"/g, '""').replace(/\r?\n/g, "<br>") + '"';
      const lines = ["#separator:Comma", "#html:true"];
      for (const it of items) lines.push([esc(it.title || "Argomento"), esc(it.text || "")].join(","));
      return lines.join("\n");
    }
    window.buildAnkiCsv = ankiCsv;

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

    async function add({ convId, title, text }) {
      const r = await fetch("/api/review", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ convId, title, text }),
      });
      const j = await r.json().catch(() => ({}));
      if (!$("#reviewDrawer").hidden) refresh();
      refreshBadge();
      return j;
    }

    $("#ankiBtn").addEventListener("click", exportAnki);
    $("#reviewBtn").addEventListener("click", () => { const d = $("#reviewDrawer"); d.hidden = !d.hidden; if (!d.hidden) refresh(); });
    $("#reviewClose").addEventListener("click", () => { $("#reviewDrawer").hidden = true; });
    refreshBadge();
    return { refreshBadge, refresh, add };
  });
})();
