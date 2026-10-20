// Runtime configuration: paths, settings (atomic), provider/key resolution,
// optional-dependency detection.
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
export const AUTH_FILE = process.env.MATHAPP_AUTH_FILE || path.join(os.homedir(), ".local", "share", "opencode", "auth.json");
export const MODELS_JSON = process.env.MATHAPP_MODELS_JSON || path.join(os.homedir(), ".cache", "opencode", "models.json");
export const SETTINGS_FILE = process.env.MATHAPP_SETTINGS_FILE || path.join(ROOT, "settings.json");
export const MAX_BODY = 64 * 1024 * 1024;

export let settings = (() => {
  try { return JSON.parse(fs.readFileSync(SETTINGS_FILE, "utf8")); } catch { return {}; }
})();

export function setSettings(next) {
  settings = next;
}

export function saveSettingsFile() {
  const tmp = SETTINGS_FILE + ".tmp." + process.pid + "." + Math.random().toString(36).slice(2);
  fs.writeFileSync(tmp, JSON.stringify(settings, null, 2), "utf8");
  fs.renameSync(tmp, SETTINGS_FILE);
}

function legacyAuth() {
  try { return JSON.parse(fs.readFileSync(AUTH_FILE, "utf8")) || {}; } catch { return {}; }
}
function legacyKey(name) {
  const v = legacyAuth()[name];
  return (v && v.key) ? String(v.key) : "";
}
export function providerName() {
  if (settings.provider === "opencode" || settings.provider === "openrouter") return settings.provider;
  return legacyKey("opencode-go") ? "opencode" : "openrouter";
}
export function currentKey() {
  if (typeof settings.apiKey === "string" && settings.apiKey) return settings.apiKey;
  return legacyKey(providerName() === "opencode" ? "opencode-go" : "openrouter");
}
export function keySource() {
  if (typeof settings.apiKey === "string" && settings.apiKey) return "settings";
  return legacyKey(providerName() === "opencode" ? "opencode-go" : "openrouter") ? "legacy" : "none";
}
export const useOR = () => providerName() === "openrouter";

export function getKey() {
  const k = currentKey();
  if (!k) throw new Error("API key non configurata: apri Impostazioni e inserisci la chiave.");
  return k;
}

export function getOrKey() {
  const k = (useOR() && settings.apiKey) ? settings.apiKey : legacyKey("openrouter");
  if (!k) throw new Error("chiave OpenRouter non configurata: apri Impostazioni e inserisci la chiave.");
  return k;
}

// Optional dependencies (cache 60 s: Python can be slow).
let diagCache = { ts: 0, data: null };
export function detectOptional() {
  if (diagCache.data && Date.now() - diagCache.ts < 60000) return diagCache.data;
  const out = { python: null, sympy: null, pypdf: null, whisper: false };
  try {
    const r = spawnSync("python", ["-c", "import sys; print(sys.version.split()[0])"], { encoding: "utf8", timeout: 3000, windowsHide: true });
    if (r.status === 0) {
      out.python = String(r.stdout || "").trim();
      const s = spawnSync("python", ["-c", "import sympy; print(sympy.__version__)"], { encoding: "utf8", timeout: 4000, windowsHide: true });
      if (s.status === 0) out.sympy = String(s.stdout || "").trim();
      const p = spawnSync("python", ["-c", "import pypdf; print(pypdf.__version__)"], { encoding: "utf8", timeout: 4000, windowsHide: true });
      if (p.status === 0) out.pypdf = String(p.stdout || "").trim();
      const w = spawnSync("python", ["-c", "import faster_whisper; print('ok')"], { encoding: "utf8", timeout: 4000, windowsHide: true });
      out.whisper = w.status === 0;
    }
  } catch {}
  diagCache = { ts: Date.now(), data: out };
  return out;
}
