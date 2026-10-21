// Orchestratore della chat: vision fallback, allegati, KB, agente e salvataggio.
// Non conosce HTTP/SSE: riceve un callback `send(event, data)`.
import crypto from "node:crypto";
import { MODELS, MODEL_VISION, VISION_FALLBACK } from "./models.mjs";
import { adapters } from "./adapters.mjs";
import { buildUpstream } from "./documents.mjs";
import { profForPrompt } from "./profile.mjs";
import { kbAdd, kbSearch, tokenize } from "./kb.mjs";
import { saveConv } from "./session-store.mjs";
import { runAgent } from "./agent.mjs";
import { settings as SETTINGS } from "./config.mjs";
import { logErr } from "./log.mjs";
import { startOperation, trace } from "./observability.mjs";
import { PROMPT_VERSION } from "./prompts.mjs";

const isFullMode = () => SETTINGS.mode === "full";

export async function executeChat({ body, send, isGone, signal, deps = {}, requestId }) {
  const op = startOperation("chat", { requestId, convId: body.conversationId || null, model: body.model || null, promptVersion: PROMPT_VERSION });
  const startedAt = Date.now();
  let firstTokenMs = null;
  const D = {
    transcribeImages: adapters.llm.vision,
    buildUpstream,
    profForPrompt,
    kbAdd,
    kbSearch,
    tokenize,
    runAgent,
    saveConv,
    logErr,
    ...deps,
  };
  const cancelled = () => !!(signal && signal.aborted) || !!(isGone && isGone());
  const sessionId = body.sessionId || crypto.randomUUID();
  const convId = body.conversationId || null;
  const model = MODELS.includes(body.model) ? body.model : MODELS[0];
  const rawMsgs = Array.isArray(body.messages) ? body.messages : [];
  const hasImages = rawMsgs.some((m) => Array.isArray(m.attachments) && m.attachments.some((a) => String(a.mime || "").startsWith("image/")));
  let usedModel = model, notice = null, msgsForBuild = rawMsgs;
  const emit = (event, data) => {
    if (event === "delta" && firstTokenMs === null) {
      firstTokenMs = Date.now() - startedAt;
      trace("chat.first_token", { id: op.id, requestId: requestId || null, ms: firstTokenMs, model: usedModel });
    }
    send(event, data);
  };

  if (hasImages && MODEL_VISION[model] === false) {
    const imgs = [];
    for (const m of rawMsgs) for (const a of (m.attachments || [])) if (String(a.mime || "").startsWith("image/")) imgs.push(a);
    try {
      const txt = await D.transcribeImages(imgs, sessionId, signal);
      msgsForBuild = rawMsgs.map((m) => {
        const mine = Array.isArray(m.attachments) ? m.attachments : [];
        const hasImg = m.role === "user" && mine.some((a) => String(a.mime || "").startsWith("image/"));
        return {
          role: m.role,
          content: hasImg ? `${m.content}\n\n[Trascrizione dell'immagine]\n${txt}` : m.content,
          attachments: mine.filter((a) => !String(a.mime || "").startsWith("image/")),
        };
      });
      notice = `Immagini trascritte con "${VISION_FALLBACK}" (strumento visione) per il modello "${model}", che non le vede direttamente.`;
    } catch (e) {
      if (cancelled()) { op.end({ cancelled: true, firstTokenMs }); return { cancelled: true }; }
      D.logErr?.("vision tool: " + e.message);
      usedModel = VISION_FALLBACK;
      notice = `Trascrizione non riuscita (${e.message}): uso "${VISION_FALLBACK}" per questo turno.`;
    }
  }

  const built = await D.buildUpstream(msgsForBuild);
  if (cancelled()) { op.end({ cancelled: true, firstTokenMs }); return { cancelled: true }; }
  const upstream = built.msgs;
  upstream.__model = usedModel;
  upstream.__conv = convId;
  upstream.__tutor = ["socratic", "step"].includes(body.tutorMode) ? body.tutorMode : null;
  upstream.__dark = !!body.dark;
  upstream.__traceId = op.id;
  upstream.__profile = D.profForPrompt(isFullMode());

  if (upstream.__tutor) {
    const note = upstream.__tutor === "socratic"
      ? "[ISTRUZIONE PRIORITARIA - modalita' ESERCITAMI: NON risolvere e NON mostrare lo svolgimento. Rispondi con UNA sola domanda di guida, breve (max 3 righe), e fermati li'.]\n\n"
      : "[ISTRUZIONE - modalita' PASSO-PASSO: struttura la risposta in passi numerati, ciascuno con titolo nel formato '### Passo N - <cosa fai>'.]\n\n";
    for (let i = upstream.length - 1; i >= 0; i--) {
      if (upstream[i].role !== "user") continue;
      const c = upstream[i].content;
      upstream[i].content = Array.isArray(c)
        ? [{ type: "text", text: note + ((c[0] && c[0].text) || "") }, ...c.slice(1)]
        : note + c;
      break;
    }
  }

  if (notice) emit("notice", { text: notice });
  for (const n of built.notices) emit("notice", { text: n });

  for (const d of built.collected) {
    const doc = D.kbAdd(d.name, d.kind, d.text, convId, d.b64, d.mime);
    if (doc) {
      const parti = [];
      if (doc.file) parti.push("file salvato (" + Math.round(doc.file.size / 1024) + " KB)");
      if (doc.chunks) parti.push(doc.chunks + " blocchi indicizzati");
      emit("notice", { text: `"${d.name}" salvato negli Appunti: ${parti.join(", ")}.` });
    }
  }

  const ultimaUser = [...rawMsgs].reverse().find((m) => m.role === "user");
  const domanda = ultimaUser ? String(ultimaUser.content || "") : "";
  const trovati = domanda ? D.kbSearch(domanda, 4) : [];
  if (trovati.length) {
    upstream.__kb = trovati;
    emit("sources", {
      items: trovati.map((c) => ({ id: c.docId, doc: c.docName, page: c.page, text: c.text.slice(0, 900) })),
      terms: [...new Set(D.tokenize(domanda))].filter((t) => t.length >= 5).slice(0, 12),
    });
  }

  const finalText = await D.runAgent(upstream, sessionId, emit, isGone, signal);
  if (cancelled()) { op.end({ cancelled: true, firstTokenMs }); return { cancelled: true }; }
  const toSave = rawMsgs.map((m) => {
    const o = { role: m.role, content: m.content };
    const names = (m.attachments || []).map((a) => a.name);
    if (names.length) o.files = names;
    return o;
  });
  if (finalText) toSave.push({ role: "assistant", content: finalText });
  D.saveConv(convId, usedModel, toSave);
  emit("conv", { id: convId });
  op.end({ ok: true, convId, usedModel, firstTokenMs });
  return { cancelled: false, finalText, convId, usedModel, firstTokenMs };
}
