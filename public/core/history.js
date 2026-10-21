// Drawer cronologia: lista paginata, ricerca, etichette e apertura sessione.
// Dipendenze iniettate da app.js: nessun accesso implicito a funzioni del monolite.
(function () {
  "use strict";

  function create(deps) {
    const {
      appState, drawer, listEl, searchEl, pageSize = 40, fmtDate, flash,
      saveState, invalidateConversationWork, renderConversation,
      getPendingWrites, sendBtn, statusEl, refreshBackupInfo,
    } = deps;
    let offset = 0;
    let total = 0;
    let loading = false;
    let seq = 0;

    function query() {
      return searchEl ? String(searchEl.value || "").trim() : "";
    }

    function empty(text) {
      const div = document.createElement("div");
      div.className = "hist-empty";
      div.textContent = text;
      return div;
    }

    function itemRow(it) {
      const row = document.createElement("div");
      row.className = "hist-item";
      const t = document.createElement("div");
      t.className = "t";
      const b = document.createElement("b");
      b.textContent = it.title || "Senza titolo";
      const s = document.createElement("span");
      const extra = [];
      if (it.figures) extra.push(it.figures + (it.figures === 1 ? " figura" : " figure"));
      else if (it.hasGgb) extra.push("figura");
      if (it.cells) extra.push(it.cells + " calcoli");
      s.textContent = fmtDate(it.updatedAt) + " \u00b7 " + it.count + " messaggi" + (extra.length ? " \u00b7 " + extra.join(" \u00b7 ") : "");
      t.append(b, s);
      if (it.match && it.match.snippet) {
        const m = document.createElement("div");
        m.className = "hist-match";
        const w = document.createElement("em");
        w.className = "hist-where";
        w.textContent = "trovato in " + (it.match.where || []).join(", ") + ": ";
        const sn = document.createElement("span");
        sn.className = "hist-snip";
        sn.textContent = it.match.snippet;
        m.append(w, sn);
        t.appendChild(m);
      }

      const tagRow = document.createElement("div");
      tagRow.className = "hist-tags";
      const changeTag = (tag, action) => fetch("/api/conversation/tags", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: it.id, tag, action }),
      }).then(() => refreshHistory()).catch(() => {});
      for (const tg of (it.tags || [])) {
        const chip = document.createElement("span");
        chip.className = "hist-tag";
        const link = document.createElement("button");
        link.type = "button";
        link.className = "hist-tag-name";
        link.textContent = "#" + tg;
        link.title = "Mostra solo gli argomenti con questa etichetta";
        link.addEventListener("click", (ev) => {
          ev.stopPropagation();
          if (searchEl) searchEl.value = "#" + tg;
          refreshHistory();
        });
        const x = document.createElement("button");
        x.type = "button";
        x.className = "hist-tag-x";
        x.textContent = "\u00d7";
        x.title = "Togli l'etichetta";
        x.addEventListener("click", (ev) => { ev.stopPropagation(); changeTag(tg, "remove"); });
        chip.append(link, x);
        tagRow.appendChild(chip);
      }
      const addBtn = document.createElement("button");
      addBtn.type = "button";
      addBtn.className = "hist-tag-add";
      addBtn.textContent = "+ etichetta";
      addBtn.title = "Aggiungi un'etichetta a questo argomento";
      addBtn.addEventListener("click", (ev) => {
        ev.stopPropagation();
        const inp = document.createElement("input");
        inp.type = "text";
        inp.className = "hist-tag-input";
        inp.maxLength = 24;
        inp.placeholder = "etichetta\u2026";
        inp.addEventListener("click", (e2) => e2.stopPropagation());
        inp.addEventListener("keydown", (e2) => {
          e2.stopPropagation();
          if (e2.key === "Enter") {
            const v = inp.value.trim();
            if (v) changeTag(v, "add"); else refreshHistory();
          } else if (e2.key === "Escape") refreshHistory();
        });
        addBtn.replaceWith(inp);
        inp.focus();
      });
      tagRow.appendChild(addBtn);
      t.appendChild(tagRow);

      const del = document.createElement("button");
      del.type = "button";
      del.className = "hist-del";
      del.textContent = "Elimina";
      del.addEventListener("click", (ev) => {
        ev.stopPropagation();
        MathAppState.dispatch("conversation.delete", { id: it.id }).catch((err) => console.warn("[MathApp] conversation.delete", err));
      });
      row.append(t, del);
      row.addEventListener("click", () => MathAppState.dispatch("conversation.open", { id: it.id }).catch((err) => console.warn("[MathApp] conversation.open", err)));
      return row;
    }

    function moreRow() {
      const box = document.createElement("div");
      box.className = "hist-more";
      const btn = document.createElement("button");
      btn.type = "button";
      btn.textContent = "Mostra altri (" + offset + " di " + total + ")";
      btn.addEventListener("click", () => refreshHistory(false));
      box.appendChild(btn);
      return box;
    }

    async function refreshHistory(reset = true) {
      if (!reset && loading) return;
      const my = ++seq;
      if (reset) {
        offset = 0;
        listEl.innerHTML = "";
      }
      loading = true;
      const q = query();
      const url = "/api/history?limit=" + pageSize + "&offset=" + offset + (q ? "&q=" + encodeURIComponent(q) : "");
      try {
        const r = await fetch(url);
        if (!r.ok) throw new Error("history " + r.status);
        const j = await r.json();
        if (my !== seq) return;
        const items = Array.isArray(j.items) ? j.items : [];
        total = Number.isFinite(Number(j.total)) ? Number(j.total) : offset + items.length;
        if (reset) listEl.innerHTML = "";
        if (!items.length) {
          if (reset) listEl.appendChild(empty(q ? "Nessun risultato. Prova con meno parole, oppure un #tag." : "Nessun argomento ancora. Le conversazioni compaiono qui."));
          offset = total;
          return;
        }
        for (const it of items) listEl.appendChild(itemRow(it));
        offset += items.length;
        const old = listEl.querySelector(".hist-more");
        if (old) old.remove();
        if (j.hasMore && offset < total) listEl.appendChild(moreRow());
      } catch {
        if (my === seq && reset) {
          listEl.innerHTML = "";
          listEl.appendChild(empty("Cronologia non disponibile."));
        }
      } finally {
        if (my === seq) loading = false;
      }
    }

    async function openConv(id) {
      const generation = invalidateConversationWork();
      const pendingWrites = getPendingWrites();
      appState.ui.conversationLoading = true;
      sendBtn.disabled = true;
      statusEl.textContent = "carico argomento\u2026";
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
      } catch {
        if (generation === appState.domain.conversationGeneration) flash("errore nel caricamento dell'argomento");
      } finally {
        if (generation === appState.domain.conversationGeneration) {
          appState.ui.conversationLoading = false;
          sendBtn.disabled = false;
          saveState();
        }
      }
    }

    function toggleHistory() {
      drawer.hidden = !drawer.hidden;
      if (!drawer.hidden) {
        refreshHistory();
        if (refreshBackupInfo) refreshBackupInfo();
      }
      return !drawer.hidden;
    }

    function closeHistory() {
      drawer.hidden = true;
      return false;
    }

    const historyBtn = document.getElementById("historyBtn");
    if (historyBtn) historyBtn.addEventListener("click", () => MathAppState.dispatch("history.toggle").catch((err) => console.warn("[MathApp] history.toggle", err)));
    const closeBtn = document.getElementById("historyClose");
    if (closeBtn) closeBtn.addEventListener("click", () => MathAppState.dispatch("history.close").catch((err) => console.warn("[MathApp] history.close", err)));

    return { refreshHistory, openConv, toggleHistory, closeHistory };
  }

  window.MathAppHistory = { create };
})();
