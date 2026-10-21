// Test del loop agente con un upstream finto: nessuna rete, nessuna chiave.
import assert from "node:assert/strict";
import { runAgent } from "../lib/agent.mjs";

let call = 0;
const stream = async () => {
  call++;
  if (call === 1) {
    return {
      content: "",
      toolCalls: [{ id: "tc-1", name: "sympy_compute", args: JSON.stringify({ operation: "diff", expr: "x^2" }) }],
      usage: { prompt_tokens: 10, completion_tokens: 2, total_tokens: 12 },
    };
  }
  return { content: "La derivata e' 2x.", toolCalls: [], usage: { prompt_tokens: 20, completion_tokens: 5, total_tokens: 25 } };
};
const sympy = async (args) => ({ ok: true, result: "2*x", latex: "2x", operation: args.operation });

const events = [];
const final = await runAgent(
  [{ role: "user", content: "Calcola la derivata di x^2" }],
  "test-session",
  (ev, data) => events.push({ ev, data }),
  () => false,
  null,
  { streamWithEscalation: stream, runSympy: sympy }
);

let ok = 0, fail = 0;
function chk(name, cond) {
  if (cond) { console.log("OK   " + name); ok++; }
  else { console.error("FAIL " + name); fail++; }
}
chk("agent: risposta finale", final === "La derivata e' 2x.");
chk("agent: tool call -> sympy_result", events.some((x) => x.ev === "sympy_result" && x.data.result.result === "2*x"));
chk("agent: verification sympy=1", events.some((x) => x.ev === "verification" && x.data.sympy === 1));
chk("agent: done emesso", events.some((x) => x.ev === "done") && events.some((x) => x.ev === "tool" && x.data.name === "sympy_compute"));
console.log("----");
console.log("OK=" + ok + " FAIL=" + fail);
if (fail) process.exit(1);
