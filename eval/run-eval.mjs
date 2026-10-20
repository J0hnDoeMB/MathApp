import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { runSympy } from "../lib/sympy.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const cases = JSON.parse(fs.readFileSync(path.join(here, "math-cases.json"), "utf8"));
let pass = 0, fail = 0;
for (const c of cases) {
  const r = await runSympy(c.args);
  const text = r && r.ok ? (typeof r.result === "string" ? r.result : JSON.stringify(r.result)) : "";
  const missing = (c.expect || []).filter((x) => !text.includes(x));
  if (r && r.ok && !missing.length) { console.log("OK   " + c.id); pass++; }
  else { console.error("FAIL " + c.id + " -> " + (r && r.error || "manca " + missing.join(", ")) + " | " + text.slice(0, 180)); fail++; }
}
console.log("----");
console.log("PASS=" + pass + " FAIL=" + fail);
if (fail) process.exit(1);
