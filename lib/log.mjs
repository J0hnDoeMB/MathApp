// Application log (bounded, never throws).
import fs from "node:fs";
import path from "node:path";
import { ROOT } from "./config.mjs";

const LOGFILE = path.join(ROOT, "mathapp.log");
export function logErr(m) {
  try {
    try { if (fs.statSync(LOGFILE).size > 512 * 1024) fs.writeFileSync(LOGFILE, ""); } catch {}
    fs.appendFileSync(LOGFILE, `[${new Date().toISOString()}] ${m}\n`);
  } catch {}
}
