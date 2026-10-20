// Modello esplicito delle capability e del degrado controllato.
import { detectOptional, keySource, settings as SETTINGS } from "./config.mjs";
import { DATA_DIR, BACKUP_DIR } from "./storage.mjs";
import { dirWritable } from "./fs-check.mjs";

export function capabilityReport() {
  const opt = detectOptional();
  const storage = dirWritable(DATA_DIR).ok && dirWritable(BACKUP_DIR).ok;
  const provider = keySource() !== "none";
  const full = SETTINGS.mode === "full";
  const caps = {
    chat: { required: true, available: true, status: "ok", note: "core" },
    provider: { required: true, available: provider, status: provider ? "ok" : "missing-key", fallback: "inserisci la API key in Impostazioni" },
    storage: { required: true, available: storage, status: storage ? "ok" : "not-writable", fallback: "controlla i permessi di data/ e backups/" },
    math: { required: false, available: !!opt.sympy, status: opt.sympy ? "ok" : "optional-missing", fallback: "calcolo esatto disattivato; chat e GeoGebra restano disponibili" },
    documents: { required: false, available: !!opt.pypdf, status: opt.pypdf ? "ok" : "optional-missing", fallback: "estrazione PDF disattivata" },
    audio: { required: false, available: !!opt.whisper, status: opt.whisper ? "ok" : "optional-missing", fallback: "dettatura disattivata" },
    geogebra: { required: false, available: null, status: "browser", fallback: "richiede browser e CDN GeoGebra" },
    tts: { required: false, available: null, status: "browser", fallback: "richiede speechSynthesis del browser" },
    fullFeatures: { required: false, available: full, status: full ? "enabled" : "core", fallback: "attiva la modalita' completa in Impostazioni" },
  };
  const coreOk = caps.chat.available && caps.provider.available && caps.storage.available;
  return { ok: coreOk, capabilities: caps };
}
