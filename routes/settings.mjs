// Route della configurazione e diagnostica.
import { settings as SETTINGS, providerName, keySource, currentKey, saveSettingsFile } from "../lib/config.mjs";
import { MODELS, MODEL_VISION, VISION_FALLBACK, OR_MODEL_MAP } from "../lib/models.mjs";
import { setWhisperLanguage } from "../lib/audio.mjs";
import { normalizeLevel } from "../lib/levels.mjs";
import { diagnostics } from "../lib/diagnostics.mjs";
import { recent } from "../lib/observability.mjs";

const isFullMode = () => SETTINGS.mode === "full";

export function handle(req, res, url, ctx) {
if (req.method === "GET" && url.pathname === "/api/models") {
    const list = providerName() === "openrouter" ? MODELS.filter((m) => OR_MODEL_MAP[m]) : MODELS;
    const def = (SETTINGS.model && list.includes(SETTINGS.model)) ? SETTINGS.model : list[0];
    res.writeHead(200, { "Content-Type": "application/json", "Cache-Control": "no-cache" });
    return res.end(JSON.stringify({ models: list, default: def, provider: providerName(), hasKey: keySource() !== "none", vision: MODEL_VISION, visionFallback: VISION_FALLBACK }));
  }
  if (req.method === "GET" && url.pathname === "/api/traces") {
    res.writeHead(200, { "Content-Type": "application/json", "Cache-Control": "no-store" });
    return res.end(JSON.stringify({ items: recent(url.searchParams.get("limit") || 50) }));
  }
  if (req.method === "GET" && (url.pathname === "/api/diagnostics" || url.pathname === "/api/health")) {
    const d = diagnostics(ctx.port);
    res.writeHead(200, { "Content-Type": "application/json", "Cache-Control": "no-store" });
    return res.end(JSON.stringify(d));
  }
  if (req.method === "GET" && url.pathname === "/api/settings") {
    const src = keySource();
    res.writeHead(200, { "Content-Type": "application/json", "Cache-Control": "no-store" });
    return res.end(JSON.stringify({
      ok: true, provider: providerName(), model: SETTINGS.model || MODELS[0],
      whisperLanguage: (SETTINGS.whisperLanguage || "it"), hasKey: src !== "none", keySource: src,
      keyHint: src === "none" ? "" : (currentKey() || "").slice(-4),
      backup: SETTINGS.backup !== false, backupHours: Number(SETTINGS.backupHours) || 24,
      mode: isFullMode() ? "full" : "core",
      level: normalizeLevel(SETTINGS.level) || "auto"
    }));
  }
  if (req.method === "POST" && url.pathname === "/api/settings") {
    const origin = req.headers.origin;
    if (origin) {
      try { if (new URL(origin).host !== req.headers.host) { res.writeHead(403); return res.end(JSON.stringify({ ok: false, err: "origin non consentita" })); } }
      catch { res.writeHead(403); return res.end(JSON.stringify({ ok: false, err: "origin non valida" })); }
    }
    let b = "";
    req.on("data", (c) => (b += c));
    req.on("end", () => {
      try {
        const j = JSON.parse(b || "{}");
        if (j.mode !== undefined) {
          if (!["core", "full"].includes(j.mode)) throw new Error("modalita' non valida");
          SETTINGS.mode = j.mode;
        }
        if (j.level !== undefined) {
          const lv = normalizeLevel(j.level);
          if (!lv) throw new Error("livello non valido");
          SETTINGS.level = lv;
        }
        if (j.provider !== undefined) {
          if (!["openrouter", "opencode"].includes(j.provider)) throw new Error("provider non valido");
          SETTINGS.provider = j.provider;
        }
        if (j.clearKey === true) delete SETTINGS.apiKey;
        if (typeof j.apiKey === "string") {
          const k = j.apiKey.trim();
          if (k.length > 500) throw new Error("chiave troppo lunga");
          if (k) SETTINGS.apiKey = k;
        }
        if (typeof j.model === "string") {
          if (!MODELS.includes(j.model)) throw new Error("modello non valido");
          SETTINGS.model = j.model;
        }
        if (typeof j.whisperLanguage === "string") {
          if (!/^[a-z]{2}$/.test(j.whisperLanguage)) throw new Error("lingua non valida");
          SETTINGS.whisperLanguage = j.whisperLanguage;
          setWhisperLanguage(j.whisperLanguage);
        }
        saveSettingsFile();
        const src = keySource();
        res.writeHead(200, { "Content-Type": "application/json", "Cache-Control": "no-store" });
        res.end(JSON.stringify({ ok: true, provider: providerName(), model: SETTINGS.model || MODELS[0], whisperLanguage: (SETTINGS.whisperLanguage || "it"), hasKey: src !== "none", keySource: src, keyHint: src === "none" ? "" : (currentKey() || "").slice(-4), mode: isFullMode() ? "full" : "core", level: normalizeLevel(SETTINGS.level) || "auto" }));
      } catch (e) {
        res.writeHead(400, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ ok: false, err: String(e.message || e) }));
      }
    });
    return true;
  }
  
  return false;
}
