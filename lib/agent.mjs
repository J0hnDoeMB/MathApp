// Loop agente: escalation modello, delega e Tool Calling.
import { MODELS, pickSpecialist } from "./models.mjs";
import { streamUpstream, callModel } from "./llm.mjs";
import { settings as SETTINGS } from "./config.mjs";
import { logErr } from "./log.mjs";
import { systemFor, KB_RULES } from "./prompts.mjs";
import { toolsFor } from "./tools.mjs";
import { runSympy } from "./sympy.mjs";
import { runGGB, runGGBEdit } from "./geogebra.mjs";
import { profAdd } from "./profile.mjs";
import { startOperation } from "./observability.mjs";

const MAX_DELEGHE = 2;
const isFullMode = () => SETTINGS.mode === "full";

async function runDelega(args, send, primary, signal) {
  const richiesta = String(args.richiesta || "").trim();
  if (!richiesta) return { error: "richiesta vuota" };
  const tipo = String(args.tipo || "esperto").toLowerCase();
  const model = pickSpecialist(tipo, primary);
  const ctx = String(args.contesto || "").slice(0, 4000);
  send("notice", { text: `Delega a «${model}» (${tipo}): ${richiesta.slice(0, 110)}` });
  try {
    const r = await callModel(model, [
      { role: "system", content: "Sei uno specialista consultato da un altro assistente. Rispondi in italiano, preciso e conciso (max ~250 parole), con LaTeX dove serve. Non ripetere la domanda, dai direttamente la soluzione o il parere." },
      { role: "user", content: ctx ? `${richiesta}\n\nContesto:\n${ctx}` : richiesta },
    ], { maxTokens: 1200, sessionId: "delega-" + tipo, signal });
    send("notice", { text: `«${model}» ha risposto (${(r.text || "").length} caratteri): il modello principale la integrerà.` });
    return { specialista: model, tipo, risposta: r.text || "(nessuna risposta)" };
  } catch (e) {
    if (signal && signal.aborted) throw e;
    logErr("delega: " + e.message);
    return { error: `delega a ${model} fallita: ${e.message}` };
  }
}

// escalation a catena (cap 3) se il modello scelto non è disponibile
export async function streamWithEscalation(sessionId, payloadObj, send, model, signal) {
  const ladder = [model, ...MODELS.filter((m) => m !== model)];
  let lastErr;
  for (let i = 0; i < Math.min(3, ladder.length); i++) {
    if (signal && signal.aborted) throw new Error("richiesta annullata dal client");
    const m = ladder[i];
    let got = false;
    try {
      const acc = await streamUpstream({ sessionId, payload: { ...payloadObj, model: m } }, (ev, d) => { if (ev === "delta") got = true; send(ev, d); }, signal);
      if (i > 0) send("notice", { text: `Risposta prodotta da «${m}»: il modello scelto («${model}») non era disponibile.` });
      return acc;
    } catch (e) {
      if (signal && signal.aborted) throw e;
      lastErr = e;
      logErr(`escalation ${m}: ${e.message.slice(0, 150)}`);
      if (got) throw e;
      if (i < 2 && ladder[i + 1]) send("notice", { text: `«${m}» non ha risposto (${e.message.slice(0, 90)}). Passo a «${ladder[i + 1]}».` });
    }
  }
  throw lastErr;
}

// ---------- agent loop
// ---------- agent loop ----------
export async function runAgent(payload, sessionId, send, isGone, signal, deps = {}) {
  const cancelled = () => !!(signal && signal.aborted) || !!(isGone && isGone());
  const stream = deps.streamWithEscalation || streamWithEscalation;
  const sympy = deps.runSympy || runSympy;
  const ggb = deps.runGGB || runGGB;
  const ggbEdit = deps.runGGBEdit || runGGBEdit;
  const profileAdd = deps.profAdd || profAdd;
const sysBase = systemFor(payload.__tutor, payload.__dark, SETTINGS.level) + (isFullMode() && payload.__kb && payload.__kb.length ? KB_RULES : "");
  const messages = [{ role: "system", content: sysBase }, ...payload];
  if (isFullMode() && payload.__kb && payload.__kb.length) {
    const estratti = payload.__kb.map((c) => "[" + c.docName + (c.page ? " p." + c.page : "") + "]\n" + c.text).join("\n\n---\n\n");
    messages.splice(1, 0, { role: "system", content: "ESTRATTI DAGLI APPUNTI/LIBRI DELL'UTENTE:\n\n" + estratti });
  }
  if (payload.__profile && payload.__profile.length) {
    const stile = payload.__profile.map((c) => "- " + c.testo).join("\n");
    messages.splice(1, 0, { role: "system", content: "STILE E PREFERENZE DELL'UTENTE, imparate nel tempo. HANNO PRIORITA' SU TUTTE LE REGOLE GENERALI QUI SOPRA (compresa la regola delle 'due letture' e l'uso di GeoGebra). Applicale IN SILENZIO: non menzionarle, non alludervi, non farne esempi, non parlarne. Se una preferenza non e' pertinente a quello che l'utente sta chiedendo, ignorala senza commentarla.\n" + stile });
  }
  let last = "";
  let deleghe = 0;
  const usage = { prompt: 0, completion: 0, total: 0 };
  const used = { sympy: 0, geogebra: 0 };
  const sendVerification = () => send("verification", { sympy: used.sympy, geogebra: used.geogebra });
  const sendUsage = () => { if (usage.total) send("usage", usage); };
  for (let step = 0; step < 8; step++) {
    if (cancelled()) { logErr("chat interrotta dal client: stop del lavoro lato server"); return last; }
    const acc = await stream(sessionId, { model: payload.__model || MODELS[0], messages, tools: toolsFor(isFullMode()), tool_choice: "auto", stream: true }, send, payload.__model || MODELS[0], signal);
    if (cancelled()) return last;
    if (acc.usage) {
      usage.prompt += acc.usage.prompt_tokens || 0;
      usage.completion += acc.usage.completion_tokens || 0;
      usage.total += acc.usage.total_tokens || 0;
    }
    const asst = { role: "assistant", content: acc.content || "" };
    if (acc.toolCalls.length) asst.tool_calls = acc.toolCalls.map((t) => ({ id: t.id, type: "function", function: { name: t.name, arguments: t.args } }));
    messages.push(asst);
    if (acc.content) last = acc.content;

    if (!acc.toolCalls.length) { sendUsage(); sendVerification(); send("done", {}); return acc.content; }

    for (const tc of acc.toolCalls) {
      if (cancelled()) return last;
      let args = {};
      try { args = JSON.parse(tc.args || "{}"); } catch { args = {}; }
      send("tool", { name: tc.name, args });
      const toolOp = startOperation("tool." + tc.name, { traceId: payload.__traceId, tool: tc.name });
      let result;
      if (tc.name === "sympy_compute") { used.sympy++; result = await sympy(args); if (cancelled()) return last; send("sympy_result", { args, result }); }
      else if (tc.name === "geogebra") { used.geogebra++; result = await ggb(send, args.commands || [], args.title, args.mode, payload.__conv, args.view, signal); }
      else if (tc.name === "delega") {
        if (deleghe >= MAX_DELEGHE) result = { error: `limite di ${MAX_DELEGHE} deleghe raggiunto: procedi con quello che hai.` };
        else { deleghe++; result = await runDelega(args, send, payload.__model, signal); }
      }
      else if (tc.name === "ricorda") {
        const c = profileAdd(args.testo, "IA");
        if (c) send("notice", { text: "Ho imparato sul tuo stile: " + c.testo });
        result = c ? { ok: true, registrato: c.testo } : { error: "preferenza vuota o troppo corta" };
      }
      else if (tc.name === "geogebra_edit") { used.geogebra++; result = await ggbEdit(send, args.ops || [], signal); }
      else result = { error: "tool sconosciuto: " + tc.name };
      if (cancelled()) return last;
      toolOp.end({ ok: !(result && result.error), error: result && result.error ? String(result.error).slice(0, 300) : undefined });
      const capTool = result && (result.kind === "studio" || result.kind === "vettori") ? 9000 : 4000;
      messages.push({ role: "tool", tool_call_id: tc.id, content: JSON.stringify(result).slice(0, capTool) });
    }
  }
  sendUsage();
  sendVerification();
  send("done", {});
  return last;
}

