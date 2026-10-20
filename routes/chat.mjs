// Route di chat, spiegazione e conferme GeoGebra.
import crypto from "node:crypto";
import { MODELS, MODEL_VISION, VISION_FALLBACK } from "../lib/models.mjs";
import { transcribeImages } from "../lib/llm.mjs";
import { buildUpstream } from "../lib/documents.mjs";
import { profForPrompt } from "../lib/profile.mjs";
import { kbAdd, kbSearch, tokenize } from "../lib/kb.mjs";
import { saveConv } from "../lib/session-store.mjs";
import { runAgent, streamWithEscalation } from "../lib/agent.mjs";
import { EXPLAIN_PROMPT } from "../lib/prompts.mjs";
import { resolveGGB } from "../lib/geogebra.mjs";
import { logErr } from "../lib/log.mjs";
import { settings as SETTINGS } from "../lib/config.mjs";

const isFullMode = () => SETTINGS.mode === "full";

export function handle(req, res, url, ctx) {
if (req.method === "POST" && url.pathname === "/api/geogebra-result") {
    let b = "";
    req.on("data", (c) => (b += c));
    req.on("end", () => {
      try { const { callId, results } = JSON.parse(b); resolveGGB(callId, results); } catch {}
      res.writeHead(200, { "Content-Type": "application/json" }); res.end('{"ok":true}');
    });
    return true;
  }
  
// Spiegazione di un singolo calcolo del quaderno, in streaming.
  // style "mixed" = parole + formule, "steps" = solo catena algebrica.
  if (req.method === "POST" && url.pathname === "/api/explain") {
    const abortController = new AbortController();
    let clientGone = false;
    const markClientGone = () => {
      if (res.writableEnded) return;
      clientGone = true;
      if (!abortController.signal.aborted) abortController.abort();
    };
    res.on("close", markClientGone);
    req.on("aborted", markClientGone);
    let b = "";
    req.on("data", (c) => (b += c));
    req.on("end", async () => {
      if (abortController.signal.aborted) return;
      let body;
      try { body = JSON.parse(b); } catch { res.writeHead(400); return res.end("bad json"); }
      const op = String(body.op || "").slice(0, 40);
      const expr = String(body.expr || "").slice(0, 600);
      const result = String(body.result || "").slice(0, 3000);
      const latex = String(body.latex || "").slice(0, 1500);
      if (!expr) { res.writeHead(400); return res.end('{"error":"espressione mancante"}'); }
      const model = MODELS.includes(body.model) ? body.model : MODELS[0];
      // L'istruzione critica va anche ACCANTO alla richiesta: cosi' il modello la segue davvero.
      const guardia = "[ISTRUZIONE — scrivi solo la spiegazione finale in italiano, senza raccontare cosa stai per fare e senza inglese.]\n\n";
      const userMsg = `${guardia}Operazione: ${op || "calcolo"}\nEspressione: ${expr}\nRisultato esatto: ${result || "(vedi LaTeX)"}${latex ? "\nLaTeX del risultato: " + latex : ""}\n\nSpiega i passaggi.`;
      res.writeHead(200, { "Content-Type": "text/event-stream; charset=utf-8", "Cache-Control": "no-cache", Connection: "keep-alive", "X-Accel-Buffering": "no" });
      const send = (event, data) => {
        if (!abortController.signal.aborted && !clientGone && !res.writableEnded && !res.destroyed) {
          try { res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`); } catch {}
        }
      };
      try {
        // Budget ampio: il modello "pensa" prima di rispondere e col budget piccolo
        // il ragionamento poteva consumare tutti i token lasciando la risposta vuota.
        await streamWithEscalation("spiega-" + Date.now(), { model, messages: [{ role: "system", content: EXPLAIN_PROMPT }, { role: "user", content: userMsg }], stream: true, max_tokens: 3500 }, send, model, abortController.signal);
        send("done", {});
      } catch (e) {
        if (!abortController.signal.aborted && !clientGone && !res.destroyed) {
          logErr("explain ERR: " + e.message);
          send("error", { message: String(e.message || e) });
        }
      }
      if (!res.writableEnded && !res.destroyed) res.end();
    });
    return true;
  }
  if (req.method === "POST" && url.pathname === "/api/chat") {
    const abortController = new AbortController();
    let clientGone = false;
    const markClientGone = () => {
      if (res.writableEnded) return;
      clientGone = true;
      if (!abortController.signal.aborted) abortController.abort();
    };
    // `IncomingMessage.close` si verifica anche quando il corpo POST è stato
    // ricevuto regolarmente; la chiusura dello stream di risposta è il segnale
    // affidabile che il browser ha annullato la chat.
    res.on("close", markClientGone);
    req.on("aborted", markClientGone);
    let b = "";
    req.on("data", (c) => (b += c));
    req.on("end", async () => {
      if (abortController.signal.aborted) return;
      let body;
      try { body = JSON.parse(b); } catch { res.writeHead(400); return res.end("bad json"); }
      const sessionId = body.sessionId || crypto.randomUUID();
      const convId = body.conversationId || null;
      const model = MODELS.includes(body.model) ? body.model : MODELS[0];
      const rawMsgs = body.messages || [];
      const hasImages = rawMsgs.some((m) => Array.isArray(m.attachments) && m.attachments.some((a) => String(a.mime || "").startsWith("image/")));
      let usedModel = model, notice = null, msgsForBuild = rawMsgs;
      if (hasImages && MODEL_VISION[model] === false) {
        const imgs = [];
        for (const m of rawMsgs) for (const a of (m.attachments || [])) if (String(a.mime || "").startsWith("image/")) imgs.push(a);
        try {
          const txt = await transcribeImages(imgs, sessionId, abortController.signal);
          msgsForBuild = rawMsgs.map((m) => {
            const mine = Array.isArray(m.attachments) ? m.attachments : [];
            const hasImg = m.role === "user" && mine.some((a) => String(a.mime || "").startsWith("image/"));
            return {
              role: m.role,
              content: hasImg ? `${m.content}\n\n[Trascrizione dell'immagine]\n${txt}` : m.content,
              attachments: mine.filter((a) => !String(a.mime || "").startsWith("image/")),
            };
          });
          notice = `Immagini trascritte con «${VISION_FALLBACK}» (strumento visione) per il modello «${model}», che non le vede direttamente.`;
        } catch (e) {
          if (abortController.signal.aborted) return;
          logErr("vision tool: " + e.message);
          usedModel = VISION_FALLBACK;
          notice = `Trascrizione non riuscita (${e.message}): uso «${VISION_FALLBACK}» per questo turno.`;
        }
      }
      const built = await buildUpstream(msgsForBuild);
      if (abortController.signal.aborted || clientGone) return;
      const upstream = built.msgs;
      upstream.__model = usedModel;
      upstream.__conv = convId;
      upstream.__tutor = ["socratic", "step"].includes(body.tutorMode) ? body.tutorMode : null;
      upstream.__dark = !!body.dark;
      upstream.__profile = profForPrompt(isFullMode());

      // Le modalità didattiche vanno ricordate ACCANTO alla domanda: nel solo prompt di sistema
      // il modello le ignora a volte.
      if (upstream.__tutor) {
        const note = upstream.__tutor === "socratic"
          ? "[ISTRUZIONE PRIORITARIA — modalita' ESERCITAMI: NON risolvere e NON mostrare lo svolgimento. Rispondi con UNA sola domanda di guida, breve (max 3 righe), e fermati li'.]\n\n"
          : "[ISTRUZIONE — modalita' PASSO-PASSO: struttura la risposta in passi numerati, ciascuno con titolo nel formato '### Passo N — <cosa fai>'.]\n\n";
        for (let i = upstream.length - 1; i >= 0; i--) {
          if (upstream[i].role !== "user") continue;
          const c = upstream[i].content;
          upstream[i].content = Array.isArray(c)
            ? [{ type: "text", text: note + ((c[0] && c[0].text) || "") }, ...c.slice(1)]
            : note + c;
          break;
        }
      }
      res.writeHead(200, { "Content-Type": "text/event-stream; charset=utf-8", "Cache-Control": "no-cache", Connection: "keep-alive", "X-Accel-Buffering": "no" });
      const send = (event, data) => {
        if (!abortController.signal.aborted && !clientGone && !res.writableEnded && !res.destroyed) {
          try { res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`); } catch {}
        }
      };
      if (notice) send("notice", { text: notice });
      for (const n of built.notices) send("notice", { text: n });

      // rete concettuale: salvo il FILE originale e indicizzo il testo
      for (const d of built.collected) {
        const doc = kbAdd(d.name, d.kind, d.text, convId, d.b64, d.mime);
        if (doc) {
          const parti = [];
          if (doc.file) parti.push("file salvato (" + Math.round(doc.file.size / 1024) + " KB)");
          if (doc.chunks) parti.push(doc.chunks + " blocchi indicizzati");
          send("notice", { text: "«" + d.name + "» salvato negli Appunti: " + parti.join(", ") + "." });
        }
      }
      const ultimaUser = [...rawMsgs].reverse().find((m) => m.role === "user");
      const domanda = ultimaUser ? String(ultimaUser.content || "") : "";
      const trovati = domanda ? kbSearch(domanda, 4) : [];
      if (trovati.length) {
        upstream.__kb = trovati;
        send("sources", {
          items: trovati.map((c) => ({ id: c.docId, doc: c.docName, page: c.page, text: c.text.slice(0, 900) })),
          terms: [...new Set(tokenize(domanda))].filter((t) => t.length >= 5).slice(0, 12),
        });
      }
      try {
        const finalText = await runAgent(upstream, sessionId, send, () => clientGone, abortController.signal);
        if (abortController.signal.aborted || clientGone || res.destroyed) return;
        const toSave = rawMsgs.map((m) => {
          const o = { role: m.role, content: m.content };
          const names = (m.attachments || []).map((a) => a.name);
          if (names.length) o.files = names;
          return o;
        });
        if (finalText) toSave.push({ role: "assistant", content: finalText });
        saveConv(convId, usedModel, toSave);
        send("conv", { id: convId });
      }
      catch (e) {
        if (abortController.signal.aborted || clientGone || res.destroyed) return;
        const m = String(e.message || e); logErr("chat ERR: " + m); send("error", { message: m });
      }
      if (!res.writableEnded && !res.destroyed) res.end();
    });
    return true;
  }
  
  return false;
}
