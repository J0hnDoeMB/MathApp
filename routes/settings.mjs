// Route della configurazione e diagnostica.
import { settings as SETTINGS, providerName, keySource, currentKey, keyForProvider, saveSettingsFile } from "../lib/config.mjs";
import { MODEL_VISION, VISION_FALLBACK, modelsForProvider, isModelForProvider } from "../lib/models.mjs";
import { setWhisperLanguage } from "../lib/audio.mjs";
import { normalizeLevel } from "../lib/levels.mjs";
import { scheduleBackups } from "../lib/storage.mjs";
import { diagnostics } from "../lib/diagnostics.mjs";
import { recent } from "../lib/observability.mjs";
import { testProviderConnection } from "../lib/llm.mjs";

const isFullMode = () => SETTINGS.mode === "full";

export function handle(req, res, url, ctx) {
  if (req.method === "GET" && url.pathname === "/api/models") {
    const requested = url.searchParams.get("provider");
    const provider = (requested === "openrouter" || requested === "opencode") ? requested : providerName();
    const list = modelsForProvider(provider);
    const def = (SETTINGS.model && list.includes(SETTINGS.model)) ? SETTINGS.model : list[0];
    const hasKey = provider === providerName() ? keySource() !== "none" : !!keyForProvider(provider);
    res.writeHead(200, { "Content-Type": "application/json", "Cache-Control": "no-cache" });
    return res.end(JSON.stringify({ models: list, default: def, provider, savedProvider: providerName(), hasKey, vision: MODEL_VISION, visionFallback: VISION_FALLBACK }));
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
    const provider = providerName();
    const list = modelsForProvider(provider);
    const model = list.includes(SETTINGS.model) ? SETTINGS.model : list[0];
    res.writeHead(200, { "Content-Type": "application/json", "Cache-Control": "no-store" });
    return res.end(JSON.stringify({
      ok: true, provider, model,
      whisperLanguage: (SETTINGS.whisperLanguage || "it"), hasKey: src !== "none", keySource: src,
      keyHint: src === "none" ? "" : (currentKey() || "").slice(-4),
      backup: SETTINGS.backup !== false, backupHours: Number(SETTINGS.backupHours) || 24,
      mode: isFullMode() ? "full" : "core",
      level: normalizeLevel(SETTINGS.level) || "auto"
    }));
  }
  if (req.method === "POST" && url.pathname === "/api/settings/test") {
    let b = "";
    req.on("data", (c) => (b += c));
    req.on("end", async () => {
      let body = {};
      try { body = JSON.parse(b || "{}"); } catch {
        res.writeHead(400, { "Content-Type": "application/json", "Cache-Control": "no-store" });
        return res.end(JSON.stringify({ ok: false, error: "richiesta non valida" }));
      }
      const result = await testProviderConnection({
        provider: body.provider,
        model: body.model,
        apiKey: typeof body.apiKey === "string" ? body.apiKey : "",
      });
      res.writeHead(result.status || 200, { "Content-Type": "application/json", "Cache-Control": "no-store" });
      res.end(JSON.stringify(result));
    });
    return true;
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
        const before = { ...SETTINGS };
        const next = { ...SETTINGS };
        const providerChanged = typeof j.provider === "string" && j.provider !== before.provider;
        let backupChanged = false;
        if (j.mode !== undefined) {
          if (!["core", "full"].includes(j.mode)) throw new Error("modalita' non valida");
          next.mode = j.mode;
        }
        if (j.level !== undefined) {
          const lv = normalizeLevel(j.level);
          if (!lv) throw new Error("livello non valido");
          next.level = lv;
        }
        if (j.provider !== undefined) {
          if (!["openrouter", "opencode"].includes(j.provider)) throw new Error("provider non valido");
          next.provider = j.provider;
        }
        if (!["openrouter", "opencode"].includes(next.provider)) next.provider = providerName();
        if (j.clearKey === true) delete next.apiKey;
        let keySupplied = false;
        if (typeof j.apiKey === "string") {
          const k = j.apiKey.trim();
          if (k.length > 500) throw new Error("chiave troppo lunga");
          if (k) { next.apiKey = k; keySupplied = true; }
        }
        if (providerChanged && !keySupplied) delete next.apiKey;
        const nextProvider = ["openrouter", "opencode"].includes(next.provider) ? next.provider : providerName();
        if (typeof j.model === "string") {
          if (!isModelForProvider(nextProvider, j.model)) throw new Error("modello non disponibile per " + nextProvider);
          next.model = j.model;
        } else if (!next.model || !isModelForProvider(nextProvider, next.model)) {
          next.model = modelsForProvider(nextProvider)[0];
        }
        if (typeof j.whisperLanguage === "string") {
          if (!/^[a-z]{2}$/.test(j.whisperLanguage)) throw new Error("lingua non valida");
          next.whisperLanguage = j.whisperLanguage;
        }
        if (j.backup !== undefined) {
          if (typeof j.backup !== "boolean") throw new Error("backup non valido");
          if ((next.backup !== false) !== j.backup) backupChanged = true;
          next.backup = j.backup;
        }
        if (j.backupHours !== undefined) {
          const hours = Number(j.backupHours);
          if (!Number.isInteger(hours) || hours < 1 || hours > 168) throw new Error("intervallo backup non valido (1-168 ore)");
          if ((Number(next.backupHours) || 24) !== hours) backupChanged = true;
          next.backupHours = hours;
        }
        for (const k of Object.keys(SETTINGS)) if (!(k in next)) delete SETTINGS[k];
        Object.assign(SETTINGS, next);
        try {
          saveSettingsFile();
        } catch (e) {
          for (const k of Object.keys(SETTINGS)) delete SETTINGS[k];
          Object.assign(SETTINGS, before);
          throw e;
        }
        if (backupChanged) scheduleBackups();
        if (typeof j.whisperLanguage === "string") setWhisperLanguage(j.whisperLanguage);
        const src = keySource();
        const list = modelsForProvider(providerName());
        const model = list.includes(SETTINGS.model) ? SETTINGS.model : list[0];
        res.writeHead(200, { "Content-Type": "application/json", "Cache-Control": "no-store" });
        res.end(JSON.stringify({ ok: true, provider: providerName(), model, whisperLanguage: (SETTINGS.whisperLanguage || "it"), hasKey: src !== "none", keySource: src, keyHint: src === "none" ? "" : (currentKey() || "").slice(-4), backup: SETTINGS.backup !== false, backupHours: Number(SETTINGS.backupHours) || 24, mode: isFullMode() ? "full" : "core", level: normalizeLevel(SETTINGS.level) || "auto" }));
      } catch (e) {
        res.writeHead(400, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ ok: false, err: String(e.message || e) }));
      }
    });
    return true;
  }
  
  return false;
}
