// LLM client: OpenCode Go (zen) and OpenRouter, streaming and non-streaming.
import { getKey, getOrKey, useOR } from "./config.mjs";
import { OR_MODEL_MAP, OR_DEFAULT, VISION_FALLBACK } from "./models.mjs";
import { logErr } from "./log.mjs";

const UPSTREAM = "https://opencode.ai/zen/go/v1/chat/completions";
const OR_UPSTREAM = "https://openrouter.ai/api/v1/chat/completions";
const OR_FALLBACK = process.env.MATHAPP_NO_OR_FALLBACK !== "1";
const OR_ROUTING = { order: ["Morph", "DeepSeek", "Together", "Fireworks", "Novita", "DigitalOcean", "DeepInfra"], allow_fallbacks: true };
const OR_NOTICE = "La chiave opencode e' scaduta o rifiutata: sto rispondendo via OpenRouter (a consumo). Rigenera la chiave da OpenCode Console oppure imposta la tua API key in Impostazioni.";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// richiesta all'upstream OpenRouter (stesso payload, modello mappato, routing Morph-first)
async function openUpstreamOpenRouter(body, signal, why) {
  const payload = { ...body.payload };
  const src = String(payload.model || "");
  payload.model = OR_MODEL_MAP[src] || OR_DEFAULT;
  payload.provider = OR_ROUTING;
  const res = await fetch(OR_UPSTREAM, {
    method: "POST",
    headers: { "Authorization": "Bearer " + getOrKey(), "Content-Type": "application/json", "User-Agent": "mathapp/1.0" },
    body: JSON.stringify(payload),
    signal,
  });
  if (!res.ok) throw new Error("fallback OpenRouter HTTP " + res.status + ": " + (await res.text()).slice(0, 300));
  logErr(`OpenRouter (${src} → ${payload.model}): ${String(why).slice(0, 160)}`);
  res.__fallback = "openrouter";
  return res;
}


export async function transcribeImages(atts, sessionId, signal) {
  const parts = [{ type: "text", text: "Trascrivi fedelmente il contenuto di queste immagini in Markdown. Metti le formule in LaTeX tra $...$. Non risolvere e non commentare: trascrivi soltanto. Se c'e' un grafico, descrivilo in una riga." }];
  for (const a of atts.slice(0, 3)) parts.push({ type: "image_url", image_url: { url: `data:${a.mime};base64,${a.b64}` } });
  if (useOR()) {
    const r = await fetch(OR_UPSTREAM, {
      method: "POST",
      headers: { "Authorization": "Bearer " + getOrKey(), "Content-Type": "application/json", "User-Agent": "mathapp/1.0" },
      body: JSON.stringify({ model: OR_MODEL_MAP[VISION_FALLBACK] || OR_DEFAULT, provider: OR_ROUTING, messages: [{ role: "user", content: parts }], stream: false, max_tokens: 1600 }),
      signal,
    });
    if (!r.ok) throw new Error("vision tool HTTP " + r.status + ": " + (await r.text()).slice(0, 200));
    const j = await r.json();
    return String((j.choices && j.choices[0] && j.choices[0].message && j.choices[0].message.content) || "").trim();
  }
  let res = await fetch(UPSTREAM, {
    method: "POST",
    headers: { "Authorization": "Bearer " + getKey(), "Content-Type": "application/json", "User-Agent": "mathapp/1.0", "x-opencode-session": sessionId + "-vision" },
    body: JSON.stringify({ model: VISION_FALLBACK, messages: [{ role: "user", content: parts }], stream: false, max_tokens: 1600 }),
    signal,
  });
  if (!res.ok && (res.status === 401 || res.status === 403) && OR_FALLBACK) {
    const why = (await res.text()).slice(0, 160);
    res = await fetch(OR_UPSTREAM, {
      method: "POST",
      headers: { "Authorization": "Bearer " + getOrKey(), "Content-Type": "application/json", "User-Agent": "mathapp/1.0" },
      body: JSON.stringify({ model: OR_MODEL_MAP[VISION_FALLBACK] || OR_DEFAULT, provider: OR_ROUTING, messages: [{ role: "user", content: parts }], stream: false, max_tokens: 1600 }),
      signal,
    });
    logErr(`transcribeImages fallback OpenRouter: ${why.slice(0, 120)}`);
  }
  if (!res.ok) throw new Error("vision tool HTTP " + res.status + ": " + (await res.text()).slice(0, 200));
  const j = await res.json();
  return String((j.choices && j.choices[0] && j.choices[0].message && j.choices[0].message.content) || "").trim();
}


export async function openUpstream(body, signal) {
  if (useOR()) return openUpstreamOpenRouter(body, signal, "provider=openrouter");
  const key = getKey();
  let lastErr;
  for (let attempt = 1; attempt <= 2; attempt++) {
    if (signal && signal.aborted) throw new Error("richiesta annullata dal client");
    let res;
    try {
      res = await fetch(UPSTREAM, {
        method: "POST",
        headers: {
          "Authorization": "Bearer " + key, "Content-Type": "application/json",
          "User-Agent": "mathapp/1.0", "x-opencode-session": body.sessionId,
        },
        body: JSON.stringify(body.payload),
        signal,
      });
    } catch (e) {
      if (signal && signal.aborted) throw e;
      lastErr = e; logErr(`upstream fetch ERR tentativo ${attempt}: ${e.message}`); if (attempt < 2) { await sleep(1500); continue; } throw e;
    }
    if (res.ok) return res;
    const txt = await res.text();
    lastErr = new Error(`upstream HTTP ${res.status}: ${txt.slice(0, 400)}`);
    logErr(`upstream HTTP ${res.status} (tentativo ${attempt}): ${txt.slice(0, 400)}`);
    // chiave scaduta o rifiutata: riprovare è inutile → fallback OpenRouter
    if ((res.status === 401 || res.status === 403) && OR_FALLBACK) {
      return openUpstreamOpenRouter(body, signal, txt);
    }
    if ((res.status >= 500 || res.status === 429) && attempt < 2) { await sleep(1500); continue; }
    throw lastErr;
  }
  throw lastErr;
}

export async function streamUpstream(body, onDelta, signal) {
  const res = await openUpstream(body, signal);
  if (res.__fallback) { try { onDelta("notice", { text: OR_NOTICE }); } catch {} }
  const reader = res.body.getReader();
  const dec = new TextDecoder();
  let buf = "";
  const acc = { content: "", reasoning: "", toolCalls: [], finish: null };
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += dec.decode(value, { stream: true });
    let i;
    while ((i = buf.indexOf("\n")) >= 0) {
      const line = buf.slice(0, i).trim();
      buf = buf.slice(i + 1);
      if (!line.startsWith("data:")) continue;
      const data = line.slice(5).trim();
      if (data === "[DONE]") continue;
      let chunk;
      try { chunk = JSON.parse(data); } catch { continue; }
      const ch = chunk.choices && chunk.choices[0];
      if (!ch) continue;
      const d = ch.delta || {};
      if (d.content) { acc.content += d.content; onDelta("delta", { text: d.content }); }
      if (d.reasoning_content) { acc.reasoning += d.reasoning_content; onDelta("reasoning", { text: d.reasoning_content }); }
      if (d.tool_calls) {
        for (const tc of d.tool_calls) {
          const idx = tc.index ?? 0;
          acc.toolCalls[idx] = acc.toolCalls[idx] || { id: "", name: "", args: "" };
          if (tc.id) acc.toolCalls[idx].id = tc.id;
          if (tc.function?.name) acc.toolCalls[idx].name = tc.function.name;
          if (tc.function?.arguments) acc.toolCalls[idx].args += tc.function.arguments;
        }
      }
      if (ch.finish_reason) acc.finish = ch.finish_reason;
      if (chunk.usage) acc.usage = chunk.usage;
    }
  }
  return acc;
}

// ---------- orchestrazione: chiamata singola, delega, escalation ----------
export async function callModel(model, messages, opts = {}) {
  const payload = Object.assign({ model, messages, stream: false, max_tokens: opts.maxTokens || 1400 }, opts.tools ? { tools: opts.tools } : {});
  if (useOR()) {
    const orPayload = { ...payload, model: OR_MODEL_MAP[model] || OR_DEFAULT, provider: OR_ROUTING };
    const r = await fetch(OR_UPSTREAM, {
      method: "POST",
      headers: { "Authorization": "Bearer " + getOrKey(), "Content-Type": "application/json", "User-Agent": "mathapp/1.0" },
      body: JSON.stringify(orPayload),
      signal: opts.signal,
    });
    if (!r.ok) throw new Error("HTTP " + r.status + ": " + (await r.text()).slice(0, 200));
    const j = await r.json();
    const msg = (j.choices && j.choices[0] && j.choices[0].message) || {};
    return { text: String(msg.content || "").trim(), reasoning: String(msg.reasoning_content || "").trim() };
  }
  let res = await fetch(UPSTREAM, {
    method: "POST",
    headers: {
      "Authorization": "Bearer " + getKey(), "Content-Type": "application/json",
      "User-Agent": "mathapp/1.0", "x-opencode-session": opts.sessionId || "delega-" + Date.now(),
    },
    body: JSON.stringify(payload),
    signal: opts.signal,
  });
  if (!res.ok && (res.status === 401 || res.status === 403) && OR_FALLBACK) {
    const why = (await res.text()).slice(0, 160);
    const orPayload = { ...payload, model: OR_MODEL_MAP[model] || OR_DEFAULT, provider: OR_ROUTING };
    res = await fetch(OR_UPSTREAM, {
      method: "POST",
      headers: { "Authorization": "Bearer " + getOrKey(), "Content-Type": "application/json", "User-Agent": "mathapp/1.0" },
      body: JSON.stringify(orPayload),
      signal: opts.signal,
    });
    logErr(`callModel fallback OpenRouter (${model} → ${orPayload.model}): ${why.slice(0, 120)}`);
  }
  if (!res.ok) throw new Error("HTTP " + res.status + ": " + (await res.text()).slice(0, 200));
  const j = await res.json();
  const msg = (j.choices && j.choices[0] && j.choices[0].message) || {};
  return { text: String(msg.content || "").trim(), reasoning: String(msg.reasoning_content || "").trim() };
}

