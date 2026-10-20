// Generazione di flashcard e quiz: prompt + chiamata modello + parsing.
import { callModel as defaultCallModel } from "./llm.mjs";
import { parseCards } from "./flashparse.mjs";
import { parseQuiz } from "./quizparse.mjs";

export function flashcardPrompt(text, n) {
  const quante = Math.max(3, Math.min(20, Number(n) || 12));
  return "Dagli ESTRATTI qui sotto crea fino a " + quante + " flashcard di matematica in italiano (domanda breve e precisa; risposta completa ma essenziale, con LaTeX dove serve). Rispondi SOLO con un array JSON nel formato [{\"d\":\"domanda\",\"r\":\"risposta\"}] - niente commenti, niente altro testo.\n\nESTRATTI:\n" + String(text || "");
}

export function quizPrompt(topic, n) {
  const arg = String(topic || "").trim().replace(/\s+/g, " ").slice(0, 300);
  const quante = Math.max(3, Math.min(10, Number(n) || 5));
  return "Crea " + quante + " domande a risposta multipla di matematica in italiano sull'argomento: \"" + arg + "\".\n"
    + "Rispondi SOLO con un array JSON nel formato [{\"d\":\"domanda\",\"opts\":[\"opzione 1\",\"opzione 2\",\"opzione 3\",\"opzione 4\"],\"ok\":0,\"why\":\"spiegazione breve\"}] - niente commenti, niente altro testo.\n"
    + "Regole: esattamente 4 opzioni per domanda, UNA sola corretta, \"ok\" = indice (0-3) della corretta, \"why\" = perche' e' giusta (1-2 frasi). Distrattori plausibili (errori tipici). Difficolta' crescente. Notazione semplice (x^2, frazioni con /), niente LaTeX.";
}

export async function generateFlashcards({ text, n, model, callModel = defaultCallModel }) {
  const prompt = flashcardPrompt(text, n);
  const out = await callModel(model, [
    { role: "system", content: "Sei un assistente che crea flashcard di studio. Rispondi solo con JSON valido." },
    { role: "user", content: prompt },
  ], { maxTokens: 2200 });
  return { prompt, cards: parseCards(out.text || ""), model };
}

export async function generateQuiz({ topic, n, model, callModel = defaultCallModel }) {
  const prompt = quizPrompt(topic, n);
  const out = await callModel(model, [
    { role: "system", content: "Sei un insegnante che prepara verifiche di matematica. Rispondi solo con JSON valido." },
    { role: "user", content: prompt },
  ], { maxTokens: 2600 });
  return { prompt, questions: parseQuiz(out.text || ""), model };
}
