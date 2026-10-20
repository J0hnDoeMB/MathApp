// Utility condivise dai servizi (niente stato del server HTTP).
import path from "node:path";
import { fileURLToPath } from "node:url";

export const PY_ENV = { ...process.env, PYTHONUTF8: "1", PYTHONIOENCODING: "utf-8" };

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
