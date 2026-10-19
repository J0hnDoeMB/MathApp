// Estrae le domande a risposta multipla {d, opts, ok, why} dalla risposta del modello:
// JSON puro, dentro un blocco ```json, oppure nel primo [...] del testo.
export function parseQuiz(text) {
  const raw = String(text || "");
  const candidates = [];
  const fence = raw.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fence) candidates.push(fence[1]);
  const arr = raw.match(/\[[\s\S]*\]/);
  if (arr) candidates.push(arr[0]);
  candidates.push(raw.trim());
  for (const c of candidates) {
    try {
      const j = JSON.parse(c);
      if (!Array.isArray(j)) continue;
      const out = [];
      for (const it of j) {
        if (!it || typeof it !== "object") continue;
        const d = String(it.d || it.domanda || it.q || "").trim();
        const optsRaw = it.opts || it.opzioni || it.options || it.risposte;
        if (!d || !Array.isArray(optsRaw)) continue;
        const opts = optsRaw.map((o) => String(o == null ? "" : o).trim().slice(0, 200)).filter(Boolean);
        if (opts.length < 2 || opts.length > 6) continue;
        let ok = Number(it.ok);
        if (!Number.isInteger(ok) && typeof it.risposta === "string") {
          // "risposta" testuale: prova a trovare l'indice dell'opzione corrispondente
          const idx = opts.findIndex((o) => o.toLowerCase() === String(it.risposta).trim().toLowerCase());
          ok = idx;
        }
        if (!Number.isInteger(ok) || ok < 0 || ok >= opts.length) continue;
        const why = String(it.why || it.spiegazione || "").trim().slice(0, 600);
        out.push({ d: d.slice(0, 400), opts, ok, why });
      }
      if (out.length) return out;
    } catch {}
  }
  return [];
}
