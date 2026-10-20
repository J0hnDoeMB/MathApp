// Plugin UI opzionale: stile imparato (memoria dell'IA).
(function () {
  MathAppPlugins.register("style", function init(app) {
    const $ = app.$;
    const flash = app.flash;
    const mkBtn = app.mkBtn;

    async function refresh() {
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
          s.textContent = (c.source === "IA" ? "imparata dall'IA" : "aggiunta da te") + " - riletta " + (c.hits || 0) + " volte";
          t.append(b, s);
          const del = mkBtn("Elimina", async (ev) => {
            ev.stopPropagation();
            await fetch("/api/profile?id=" + encodeURIComponent(c.id), { method: "DELETE" });
            refresh();
          }, "hist-del");
          row.append(t, del);
          list.appendChild(row);
        }
      } catch { list.innerHTML = '<div class="hist-empty">Memoria non disponibile.</div>'; }
    }

    async function add() {
      const input = $("#styleInput");
      const v = input.value.trim();
      if (!v) return;
      const r = await fetch("/api/profile", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ testo: v }) });
      if (r.ok) { input.value = ""; refresh(); flash("preferenza salvata: la rileggera' prima di rispondere"); }
      else flash("preferenza troppo corta");
    }

    $("#styleBtn").addEventListener("click", () => { const d = $("#styleDrawer"); d.hidden = !d.hidden; if (!d.hidden) refresh(); });
    $("#styleClose").addEventListener("click", () => { $("#styleDrawer").hidden = true; });
    $("#styleAdd").addEventListener("click", add);
    $("#styleInput").addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); add(); } });

    return { refresh, add };
  });
})();
