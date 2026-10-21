// PDF/Markdown export: receives the application state and UI helpers from app.js.
// Classic script; no module bundler required.
window.MathAppExport = {
  create({ appState, chatEl, escapeHtml, flash }) {
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

    async function exportNotebookPdf() {
      const cells = document.querySelector("#calcCells");
      if (!cells || !appState.domain.cellData.length) { flash("il quaderno è vuoto: niente da esportare"); return; }
      const css = await fetch("/style.css").then((r) => r.text()).catch(() => "");
      const title = ((appState.domain.messages.find((m) => m.role === "user") || {}).content || "Quaderno MathApp").slice(0, 80);
      const tmp = cells.cloneNode(true);
      [...tmp.children].reverse().forEach((c) => tmp.appendChild(c)); // from first calculation to last
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

    return { exportPdf, exportNotebookPdf, exportMarkdown };
  },
};
