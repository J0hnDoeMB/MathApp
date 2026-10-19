// Estrae l'elenco di flashcard {d, r} dalla risposta del modello:
// JSON puro, dentro un blocco ```json, oppure nel primo [...] del testo.
export function parseCards(text) {
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
        const d = String((it && (it.d || it.domanda || it.front)) || "").trim();
        const r = String((it && (it.r || it.risposta || it.back)) || "").trim();
        if (d && r) out.push({ d: d.slice(0, 300), r: r.slice(0, 1200) });
      }
      if (out.length) return out;
    } catch {}
  }
  // ultima spiaggia: righe "domanda | risposta"
  const out = [];
  for (const l of raw.split("\n").map((s) => s.trim()).filter(Boolean)) {
    const pulita = l.replace(/^\s*(?:[-*•]|\d+[.)])\s+/, "");
    const m = pulita.match(/^(.+?)\s+[|→]\s+(.+)$/);
    if (m) out.push({ d: m[1].slice(0, 300), r: m[2].slice(0, 1200) });
  }
  return out;
}
