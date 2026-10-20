// Route di chat, spiegazione e conferme GeoGebra.
import { MODELS } from "../lib/models.mjs";
import { streamWithEscalation } from "../lib/agent.mjs";
import { EXPLAIN_PROMPT } from "../lib/prompts.mjs";
import { resolveGGB } from "../lib/geogebra.mjs";
import { logErr } from "../lib/log.mjs";
import { executeChat } from "../lib/chat-service.mjs";

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
    res.on("close", markClientGone);
    req.on("aborted", markClientGone);
    let b = "";
    req.on("data", (c) => (b += c));
    req.on("end", async () => {
      if (abortController.signal.aborted) return;
      let body;
      try { body = JSON.parse(b); } catch { res.writeHead(400); return res.end("bad json"); }
      res.writeHead(200, { "Content-Type": "text/event-stream; charset=utf-8", "Cache-Control": "no-cache", Connection: "keep-alive", "X-Accel-Buffering": "no" });
      const send = (event, data) => {
        if (!abortController.signal.aborted && !clientGone && !res.writableEnded && !res.destroyed) {
          try { res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`); } catch {}
        }
      };
      try {
        await executeChat({ body, send, isGone: () => clientGone, signal: abortController.signal });
      } catch (e) {
        if (!abortController.signal.aborted && !clientGone && !res.destroyed) {
          logErr("chat ERR: " + (e && e.message || e));
          send("error", { message: String(e && e.message || e) });
        }
      }
      if (!res.writableEnded && !res.destroyed) res.end();
    });
    return true;
  }

  return false;
}
