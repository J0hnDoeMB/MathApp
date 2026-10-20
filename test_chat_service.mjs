// Test dell'orchestratore chat con dipendenze finte: nessuna rete.
import assert from "node:assert/strict";
import { executeChat } from "./lib/chat-service.mjs";

const events = [];
let saved = null;
const result = await executeChat({
  body: {
    conversationId: "test-chat",
    messages: [{ role: "user", content: "Spiega x^2" }],
    model: "deepseek-v4.1-flash",
  },
  send: (ev, data) => events.push({ ev, data }),
  isGone: () => false,
  signal: null,
  deps: {
    buildUpstream: async () => ({
      msgs: [{ role: "user", content: "Spiega x^2" }],
      notices: ["allegato letto"],
      collected: [{ name: "nota.txt", kind: "testo", text: "nota", b64: "", mime: "text/plain" }],
    }),
    profForPrompt: () => [],
    kbAdd: () => ({ file: { size: 1024 }, chunks: 2 }),
    kbSearch: () => [],
    tokenize: () => ["spiega"],
    runAgent: async (payload, sessionId, send) => {
      send("delta", { text: "Risposta" });
      send("verification", { sympy: 1, geogebra: 0 });
      return "Risposta";
    },
    saveConv: (id, model, msgs) => { saved = { id, model, msgs }; },
  },
});

let ok = 0, fail = 0;
function chk(name, cond) { if (cond) { console.log("OK   " + name); ok++; } else { console.error("FAIL " + name); fail++; } }
chk("chat-service: risposta finale", result.finalText === "Risposta" && result.convId === "test-chat");
chk("chat-service: eventi SSE", events.some((e) => e.ev === "delta") && events.some((e) => e.ev === "verification") && events.some((e) => e.ev === "conv"));
chk("chat-service: allegato + appunti", events.some((e) => e.ev === "notice" && /allegato letto/.test(e.data.text)) && events.some((e) => e.ev === "notice" && /salvato negli Appunti/.test(e.data.text)));
chk("chat-service: sessione salvata", saved && saved.id === "test-chat" && saved.msgs.length === 2 && saved.msgs[1].content === "Risposta");
console.log("----");
console.log("OK=" + ok + " FAIL=" + fail);
if (fail) process.exit(1);
