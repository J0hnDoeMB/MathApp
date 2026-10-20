// Servizio di calcolo esatto: invoca sympy_cli.py via processo figlio.
import path from "node:path";
import { spawn } from "node:child_process";
import { projectRoot, PY_ENV } from "./util.mjs";

const ROOT = projectRoot(import.meta.url);
const SYMPY_CLI = path.join(ROOT, "sympy_cli.py");
const SYMPY_TIMEOUT_MS = Math.max(1, Math.min(120000, Number(process.env.MATHAPP_SYMPY_TIMEOUT_MS) || 20000));
const SYMPY_MAX_OUTPUT_BYTES = 2 * 1024 * 1024;
const SYMPY_MAX_CONCURRENCY = 2;
let sympyProcesses = 0;

export function runSympy(args) {
  if (sympyProcesses >= SYMPY_MAX_CONCURRENCY) {
    return Promise.resolve({ ok: false, error: "sympy_cli: calcolatore occupato, riprova tra poco" });
  }
  sympyProcesses++;
  return new Promise((resolve) => {
    let out = "", err = "", outBytes = 0, settled = false, timer;
    const finish = (value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      sympyProcesses = Math.max(0, sympyProcesses - 1);
      resolve(value);
    };
    let p;
    try {
      p = spawn("python", [SYMPY_CLI, JSON.stringify(args)], { windowsHide: true, env: PY_ENV });
    } catch (e) {
      finish({ ok: false, error: "spawn sympy_cli fallito: " + e.message });
      return;
    }
    timer = setTimeout(() => {
      try { p.kill(); } catch {}
      finish({ ok: false, error: "sympy_cli: tempo limite superato" });
    }, SYMPY_TIMEOUT_MS);
    p.stdout.on("data", (d) => {
      if (settled) return;
      outBytes += d.length;
      if (outBytes > SYMPY_MAX_OUTPUT_BYTES) {
        try { p.kill(); } catch {}
        finish({ ok: false, error: "sympy_cli: risultato supera il limite di dimensione" });
        return;
      }
      out += d.toString("utf8");
    });
    p.stderr.on("data", (d) => { if (!settled && err.length < 8192) err += d.toString("utf8").slice(0, 8192 - err.length); });
    p.on("close", () => {
      if (settled) return;
      try { finish(JSON.parse(out.trim())); }
      catch { finish({ ok: false, error: "sympy_cli: risposta non valida", raw: out.slice(0, 400), stderr: err.slice(0, 300) }); }
    });
    p.on("error", (e) => finish({ ok: false, error: "spawn sympy_cli fallito: " + e.message }));
  });
}
