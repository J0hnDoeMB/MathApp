// Provider fallback: OpenCode 401 -> OpenRouter, con fetch finto.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import assert from "node:assert/strict";

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "mathapp-provider-"));
const settingsFile = path.join(tmp, "settings.json");
const authFile = path.join(tmp, "auth.json");
fs.writeFileSync(settingsFile, JSON.stringify({ provider: "opencode", apiKey: "oc-test", model: "deepseek-v4.1-flash" }), "utf8");
fs.writeFileSync(authFile, JSON.stringify({ openrouter: { key: "or-test" } }), "utf8");
process.env.MATHAPP_SETTINGS_FILE = settingsFile;
process.env.MATHAPP_AUTH_FILE = authFile;

const calls = [];
global.fetch = async (url) => {
  calls.push(String(url));
  if (String(url).includes("opencode.ai")) return new Response("expired", { status: 401 });
  if (String(url).includes("openrouter.ai")) return new Response(JSON.stringify({ choices: [] }), { status: 200, headers: { "content-type": "application/json" } });
  return new Response("unexpected", { status: 500 });
};

const llm = await import("./lib/llm.mjs?test=" + Date.now());
let ok = 0, fail = 0;
function chk(name, cond) { if (cond) { console.log("OK   " + name); ok++; } else { console.error("FAIL " + name); fail++; } }
try {
  const res = await llm.openUpstream({ sessionId: "s", payload: { model: "deepseek-v4.1-flash", messages: [] } }, null);
  chk("provider: fallback OpenRouter", res.__fallback === "openrouter");
  chk("provider: due chiamate (OpenCode poi OpenRouter)", calls.length === 2 && calls[1].includes("openrouter.ai"));
} finally {
  fs.rmSync(tmp, { recursive: true, force: true });
}
console.log("----");
console.log("OK=" + ok + " FAIL=" + fail);
if (fail) process.exit(1);
