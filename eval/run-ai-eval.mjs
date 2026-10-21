// Optional real-provider eval. It is deliberately not part of CI: it needs a
// key, network access and human judgement for quality. The deterministic math
// eval lives in run-eval.mjs and runs without a provider.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const key = process.env.MATHAPP_AI_EVAL_KEY;
if (!key) {
  console.log("SKIP: set MATHAPP_AI_EVAL_KEY to run the real-provider eval (never commit the key).");
  process.exit(0);
}

const here = path.dirname(fileURLToPath(import.meta.url));
const cases = JSON.parse(fs.readFileSync(path.join(here, "ai-cases.json"), "utf8"));
const base = (process.env.MATHAPP_AI_EVAL_BASE || "https://openrouter.ai/api/v1").replace(/\/$/, "");
const model = process.env.MATHAPP_AI_EVAL_MODEL || "deepseek/deepseek-v4-flash-0731";
const SUPERSCRIPT = { "⁰": "0", "¹": "1", "²": "2", "³": "3", "⁴": "4", "⁵": "5", "⁶": "6", "⁷": "7", "⁸": "8", "⁹": "9" };
const normalize = (s) => String(s || "")
  .toLowerCase()
  .replace(/[⁰¹²³⁴⁵⁶⁷⁸⁹]/g, (d) => "^" + SUPERSCRIPT[d])
  .replace(/\s+/g, "")
  .replace(/\*/g, "");

let pass = 0;
let fail = 0;
for (const c of cases) {
  try {
    const res = await fetch(base + "/chat/completions", {
      method: "POST",
      headers: { Authorization: "Bearer " + key, "Content-Type": "application/json" },
      body: JSON.stringify({
        model,
        temperature: 0,
        max_tokens: 300,
        messages: [{ role: "user", content: c.prompt }],
      }),
      signal: AbortSignal.timeout(90000),
    });
    if (!res.ok) throw new Error("HTTP " + res.status + ": " + (await res.text()).slice(0, 200));
    const data = await res.json();
    const text = data?.choices?.[0]?.message?.content || "";
    const normalized = normalize(text);
    const missing = (c.contains || []).filter((x) => !normalized.includes(normalize(x)));
    if (text && !missing.length) {
      console.log("OK   " + c.id);
      pass++;
    } else {
      console.error("FAIL " + c.id + " -> " + (missing.length ? "manca " + missing.join(", ") : "risposta vuota") + " | " + text.slice(0, 200));
      fail++;
    }
  } catch (e) {
    console.error("FAIL " + c.id + " -> " + e.message);
    fail++;
  }
}

console.log("----");
console.log("PASS=" + pass + " FAIL=" + fail + " model=" + model);
if (fail) process.exit(1);
