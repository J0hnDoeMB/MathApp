// Livelli di dettaglio della spiegazione (indipendenti dalla scuola).
export const LEVELS = ["auto", "breve", "dettagliato", "approfondito"];

export function normalizeLevel(l) {
  const alias = { base: "breve", superiore: "dettagliato", universita: "approfondito" };
  const v = alias[l] || l;
  return LEVELS.includes(v) ? v : null;
}

export function levelRule(level) {
  const l = normalizeLevel(level) || "auto";
  const rules = {
    auto: "deduci il dettaglio richiesto dalla domanda; se non e' chiaro parti da una spiegazione completa ma senza digressioni.",
    breve: "risposta sintetica: solo i passaggi essenziali, niente digressioni; una riga di contesto e il risultato.",
    dettagliato: "spiega ogni passaggio e il perche'; aggiungi un esempio concreto quando aiuta; e' il livello piu' equilibrato.",
    approfondito: "aggiungi definizioni, ipotesi, varianti, controesempi e collegamenti; puoi essere piu' lungo, ma resta ordinato e pertinente.",
  };
  return "\n- LIVELLO (" + l + "): " + rules[l];
}
