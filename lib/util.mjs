// Utility condivise dai servizi (niente stato del server HTTP).
import path from "node:path";
import { fileURLToPath } from "node:url";

export const PY_ENV = { ...process.env, PYTHONUTF8: "1", PYTHONIOENCODING: "utf-8" };

// Unisce piu' AbortSignal senza perdere il motivo dell'annullamento.
export function mergeAbortSignals(...signals) {
  const ctrl = new AbortController();
  for (const signal of signals) {
    if (!signal) continue;
    if (signal.aborted) { ctrl.abort(signal.reason); break; }
    signal.addEventListener("abort", () => ctrl.abort(signal.reason), { once: true });
  }
  return ctrl.signal;
}

// fetch con timeout di connessione/risposta: evita richieste appese per sempre.
export async function fetchWithTimeout(url, options = {}, timeoutMs = 120000) {
  const { signal, timeout, ...rest } = options || {};
  const ms = Math.max(1, Number(timeout || timeoutMs) || 120000);
  const timeoutCtrl = new AbortController();
  const merged = mergeAbortSignals(signal, timeoutCtrl.signal);
  const timer = setTimeout(() => timeoutCtrl.abort(new Error(`timeout richiesta (${ms}ms)`)), ms);
  try {
    return await fetch(url, { ...rest, signal: merged });
  } catch (e) {
    if (timeoutCtrl.signal.aborted && !(signal && signal.aborted)) throw new Error(`timeout richiesta (${ms}ms)`);
    throw e;
  } finally {
    clearTimeout(timer);
  }
}

// Windows: i processi Python figli devono parlare UTF-8.
export function projectRoot(metaUrl) {
  return path.resolve(path.dirname(fileURLToPath(metaUrl)), "..");
}

// Cache con tetto: evita crescita illimitata in sessioni lunghe.
export function cachePut(map, key, val, max = 24) {
  if (!map.has(key) && map.size >= max) map.clear();
  map.set(key, val);
  return val;
}
