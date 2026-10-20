// Composizione delle route API. Le feature opzionali sono plugin caricati
// on-demand solo in modalita' "full".
import * as settings from "./settings.mjs";
import * as backup from "./backup.mjs";
import * as compute from "./compute.mjs";
import * as conversations from "./conversations.mjs";
import * as chat from "./chat.mjs";
import { featureForPath } from "../lib/features.mjs";

const coreHandlers = [settings, backup, compute, conversations, chat];
const pluginCache = new Map();

async function loadPlugin(feature) {
  let mod = pluginCache.get(feature.id);
  if (mod) return mod;
  mod = await import(new URL("./" + feature.module + ".mjs", import.meta.url).href);
  if (!mod || typeof mod.handle !== "function") throw new Error("plugin senza handle: " + feature.id);
  if (mod.feature && mod.feature !== feature.id) throw new Error("plugin id non valido: " + feature.id);
  pluginCache.set(feature.id, mod);
  return mod;
}

export async function prepareApi(pathname, fullMode) {
  if (!fullMode) return { ok: true };
  const feature = featureForPath(pathname);
  if (!feature) return { ok: true };
  try { await loadPlugin(feature); return { ok: true }; }
  catch (e) { return { ok: false, error: String(e && e.message || e) }; }
}

export function handleApi(req, res, url, ctx) {
  for (const h of coreHandlers) {
    if (h.handle(req, res, url, ctx)) return true;
  }
  const feature = featureForPath(url.pathname);
  if (!feature) return false;
  const mod = pluginCache.get(feature.id);
  if (!mod) {
    const message = "plugin " + feature.id + " non caricato";
    console.error("[MathApp] " + message);
    res.writeHead(500, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ ok: false, error: message }));
    return true;
  }
  return mod.handle(req, res, url, ctx) === true;
}
