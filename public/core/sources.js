// Sources from notes/books: choose the passage the answer actually reused.
// Classic script; depends on public/core/format.js for escapeHtml.
window.MathAppSources = (() => {
  const { escapeHtml } = window.MathAppFormat;
  const escapeRe = (s) => String(s).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const STOP_W = new Set(["della","delle","dello","degli","questo","questa","questi","queste","sono","essere","avere","come","anche","perche","quando","dove","quale","quali","tutto","tutti","molto","poco","the","and","for","with","that","this","from","una","uno","gli","dei","che","non","per","con","tra","fra","sul","sui","nel","nei","alla","allo","agli","fare","piu","meno","solo","ogni","sua","suo","suoi","sue","quindi","allora","infatti","vedi","questo","cioe","dopo","prima","stesso","stessa","esempio","esempi","risultato","risultati"]);

  // Significant words: long and non-generic.
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

  // Find the excerpt passage the answer really reused, excluding words from the file name.
  function bestPassage(excerpt, answerTerms, exclude) {
    const sents = String(excerpt || "").split(/(?<=[.!?;:])\s+|\n+/).map((s) => s.trim()).filter((s) => s.length > 15);
    let best = null, bestShared = [], bestScore = -1;
    for (const s of sents) {
      const set = new Set(sigTerms(s));
      const shared = [...set].filter((t) => answerTerms.has(t) && !(exclude && exclude.has(t)));
      // At equal shared words, prefer content (formulas/numbers) over headings.
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
      // Show it only when cited or when at least two significant words were reused.
      if (esplicitamente || shared.length >= 2) usate.push({ s, sentence, shared });
    }
    if (!usate.length) return;

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

  return { sigTerms, highlightTerms, bestPassage, renderSources };
})();
