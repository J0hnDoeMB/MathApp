// LLM: mapping OpenRouter esplicito, nessun fallback silenzioso.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "mathapp-llm-models-"));
const settingsFile = path.join(tmp, "settings.json");
fs.writeFileSync(settingsFile, JSON.stringify({ provider: "openrouter", apiKey: "or-test", model: "deepseek-v4.1-flash" }), "utf8");
process.env.MATHAPP_SETTINGS_FILE = settingsFile;

let hits = 0;
let lastBody = null;
global.fetch = async (_url, init) => {
  hits++;
  lastBody = JSON.parse(init.body);
  return new Response(JSON.stringify({ choices: [{ message: { content: "OK" } }] }), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
};

const llm = await import("../lib/llm.mjs?test=" + Date.now());
let ok = 0, fail = 0;
function chk(name, cond) { if (cond) { console.log("OK   " + name); ok++; } else { console.error("FAIL " + name); fail++; } }

try {
  let rejected = null;
  try {
    await llm.callModel("space-bunny", [{ role: "user", content: "x" }]);
  } catch (e) {
    rejected = e;
  }
  chk("llm: modello non OpenRouter rifiutato senza chiamata", !!rejected && rejected.code === "MODEL_NOT_AVAILABLE" && /non disponibile per openrouter/.test(rejected.message) && hits === 0);

  const out = await llm.callModel("deepseek-v4.1-flash", [{ role: "user", content: "x" }]);
  chk("llm: modello valido mappato e risposta", out.text === "OK" && hits === 1 && lastBody.model === "deepseek/deepseek-v4.1-flash");
} finally {
  fs.rmSync(tmp, { recursive: true, force: true });
}

console.log("----");
console.log("OK=" + ok + " FAIL=" + fail);
if (fail) process.exit(1);
