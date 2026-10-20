// Plugin UI opzionale: Appunti / rete concettuale.
(function () {
  MathAppPlugins.register("kb", function init(app) {
    const $ = app.$;
    const flash = app.flash;
    const mkBtn = app.mkBtn;
    const fmtDate = app.fmtDate;
    const b64FromBlob = app.b64FromBlob;
    const refreshReviewBadge = app.refreshReviewBadge;

    async function load(files) {
      if (!files.length) return;
      const st = $("#kbStatus");
      let ok = 0;
      for (const f of files) {
        if (f.size > 40 * 1024 * 1024) { st.textContent = "\"" + f.name + "\" troppo grande (max 40 MB)"; continue; }
        st.textContent = "elaboro \"" + f.name + "\"...";
        try {
          const b64 = await b64FromBlob(f);
          const r = await fetch("/api/kb/add", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name: f.name, mime: f.type || "application/octet-stream", b64 }) });
          const j = await r.json();
          if (j.ok) { ok++; st.textContent = "\"" + f.name + "\" aggiunto (" + (j.doc.chunks || 0) + " blocchi)"; }
          else st.textContent = "\"" + f.name + "\": " + (j.error || "non leggibile");
        } catch (err) { st.textContent = "\"" + f.name + "\": errore " + err.message; }
      }
      refresh();
      if (ok) setTimeout(() => { const s = $("#kbStatus"); if (s) s.textContent = ""; }, 3000);
    }

    async function refresh() {
      const list = $("#kbList");
      try {
        const j = await (await fetch("/api/kb")).json();
        if (!j.docs.length) {
          list.innerHTML = '<div class="hist-empty">Nessun appunto ancora.<br>Premi "Carica appunti" oppure allega un file in chat.</div>';
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
          s.textContent = parti.join(" — ");
          t.append(b, s);
          row.append(t);
          if (d.file) {
            const open = document.createElement("a");
            open.className = "kb-open";
            open.href = "/api/kb/file?id=" + encodeURIComponent(d.id);
            open.target = "_blank"; open.rel = "noopener"; open.textContent = "Apri";
            open.addEventListener("click", (ev) => ev.stopPropagation());
            row.append(open);
          }
          if (d.chunks) {
            row.append(mkBtn("Flashcard", async (ev) => {
              ev.stopPropagation();
              const b = ev.currentTarget;
              b.disabled = true; const old = b.textContent; b.textContent = "creo...";
              try {
                const r = await (await fetch("/api/flashcards", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ docId: d.id }) })).json();
                flash(r.ok ? ("Ripasso: +" + r.added + " flashcard" + (r.parsed > r.added ? " (" + (r.parsed - r.added) + " gia' presenti)" : "")) : ("flashcard: " + (r.error || "non riuscite")));
                if (r.ok && refreshReviewBadge) refreshReviewBadge();
              } catch { flash("flashcard: errore di rete"); }
              b.disabled = false; b.textContent = old;
            }, "kb-flash"));
          }
          row.append(mkBtn("Elimina", async (ev) => {
            ev.stopPropagation();
            if (!confirm("Togliere \"" + d.name + "\" dagli appunti?\nIl file viene spostato nel cestino (recuperabile), le citazioni non compariranno piu'.")) return;
            await fetch("/api/kb/doc?id=" + encodeURIComponent(d.id), { method: "DELETE" });
            const v = $("#kbViewer");
            if (v.dataset.doc === d.id) { v.hidden = true; v.dataset.doc = ""; }
            refresh();
          }, "hist-del"));
          row.addEventListener("click", () => openDoc(d));
          list.appendChild(row);
        }
      } catch { list.innerHTML = '<div class="hist-empty">Rete concettuale non disponibile.</div>'; }
    }

    async function openDoc(doc) {
      const v = $("#kbViewer");
      v.hidden = false; v.dataset.doc = doc.id;
      v.innerHTML = '<p class="kb-chunk">carico...</p>';
      try {
        const j = await (await fetch("/api/kb/doc?id=" + encodeURIComponent(doc.id))).json();
        if (v.dataset.doc !== doc.id) return;
        v.innerHTML = "";
        const bar = document.createElement("div"); bar.className = "kb-viewer-head";
        const head = document.createElement("div"); head.className = "sources-head";
        head.textContent = doc.name + " - " + (j.chunks || []).length + " blocchi";
        bar.append(head, mkBtn("Chiudi", () => { v.hidden = true; v.dataset.doc = ""; }, "kb-open"));
        v.appendChild(bar);
        if (!j.chunks || !j.chunks.length) {
          const e = document.createElement("p"); e.className = "kb-chunk";
          e.textContent = "Nessun testo indicizzato (es. immagine o PDF scansionato). Il file e' comunque archiviato e apribile con Apri.";
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
          m.textContent = "...altri " + (j.chunks.length - 80) + " blocchi non mostrati (usa Apri per il file completo).";
          v.appendChild(m);
        }
      } catch { if (v.dataset.doc === doc.id) v.innerHTML = '<p class="kb-chunk">errore nel caricamento</p>'; }
    }

    $("#kbUpload").addEventListener("click", () => $("#kbFile").click());
    $("#kbFile").addEventListener("change", (e) => { load(Array.from(e.target.files || [])); e.target.value = ""; });
    const drawer = $("#kbDrawer");
    drawer.addEventListener("dragover", (e) => { e.preventDefault(); drawer.classList.add("drop-target"); });
    drawer.addEventListener("dragleave", () => drawer.classList.remove("drop-target"));
    drawer.addEventListener("drop", (e) => {
      e.preventDefault(); drawer.classList.remove("drop-target");
      if (e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files.length) load(Array.from(e.dataTransfer.files));
    });
    $("#kbBtn").addEventListener("click", () => { const d = $("#kbDrawer"); d.hidden = !d.hidden; if (!d.hidden) refresh(); });
    $("#kbClose").addEventListener("click", () => { $("#kbDrawer").hidden = true; });

    window.MathAppKb = { refresh };
    return { refresh, load };
  });
})();
