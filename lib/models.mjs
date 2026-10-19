// Model catalog, capabilities and specialists (local cache when available).
import fs from "node:fs";
import { MODELS_JSON } from "./config.mjs";

export const OR_MODEL_MAP = {
  "deepseek-v4.1-flash": "deepseek/deepseek-v4.1-flash",
  "deepseek-v4-flash": "deepseek/deepseek-v4-flash",
  "deepseek-v4-pro": "deepseek/deepseek-v4-pro",
  "glm-5.3-flash": "z-ai/glm-5.3-flash",
  "mimo-v2.6-flash": "xiaomi/mimo-v2.6-flash",
  "qwen3.8-flash": "qwen/qwen3.8-flash",
  "qwen3.8-max": "qwen/qwen3.8-max-0902",
  "longcat-2.5-preview-free": "meituan/longcat-2.0",
};
export const OR_DEFAULT = "deepseek/deepseek-v4-flash";

export const MODELS = [
  "deepseek-v4.1-flash",
  "deepseek-v4-flash",
  "glm-5.3-flash",
  "mimo-v2.6-flash",
  "qwen3.8-flash",
  "longcat-2.5-preview-free",
  "space-bunny",
  "deepseek-v4-pro",
  "qwen3.8-max",
];

// Capacità (dal catalogo opencode): chi legge le immagini?
export const MODEL_VISION = (() => {
  const out = {};
  try {
    const mj = JSON.parse(fs.readFileSync(MODELS_JSON, "utf8"));
    const go = (mj["opencode-go"] && mj["opencode-go"].models) || {};
    for (const [id, m] of Object.entries(go)) {
      const inp = (m.modalities && m.modalities.input) || [];
      const list = Array.isArray(inp) ? inp : String(inp).split(/\s+/);
      out[id] = list.includes("image");
    }
  } catch {}
  return out;
})();
export const VISION_FALLBACK = MODELS.find((m) => MODEL_VISION[m] === true) || "deepseek-v4.1-flash";

// Capacità complete (contesto, costo, tool) per l'orchestrazione.
export const MODEL_CAPS = (() => {
  const out = {};
  try {
    const mj = JSON.parse(fs.readFileSync(MODELS_JSON, "utf8"));
    const go = (mj["opencode-go"] && mj["opencode-go"].models) || {};
    for (const [id, m] of Object.entries(go)) {
      const raw = (m.modalities && m.modalities.input) || [];
      const inp = Array.isArray(raw) ? raw : String(raw).split(/\s+/);
      out[id] = {
        image: inp.includes("image"), audio: inp.includes("audio"), video: inp.includes("video"),
        tools: !!m.tool_call,
        context: (m.limit && m.limit.context) || 0,
        costIn: (m.cost && m.cost.input) || 0, costOut: (m.cost && m.cost.output) || 0,
      };
    }
  } catch {}
  return out;
})();

// Specialisti usati dal tool "delega" - solo modelli verificati sull'endpoint OpenAI.
const OPENAI_OK = ["deepseek-v4.1-flash", "deepseek-v4-flash", "deepseek-v4-pro", "glm-5.3", "glm-5.3-flash", "qwen3.8-max", "qwen3.7-plus", "qwen3.8-flash", "kimi-k3", "minimax-m3", "mimo-v2.6-pro", "mimo-v2.6-flash", "longcat-2.0", "hy3"];
const EXPERT_MODEL = ["qwen3.8-max", "deepseek-v4-pro", "glm-5.3"].find((m) => OPENAI_OK.includes(m)) || MODELS[0];
const VERIFY_MODEL = ["deepseek-v4-pro", "glm-5.3", "kimi-k3"].find((m) => OPENAI_OK.includes(m)) || MODELS[0];
const LONG_MODEL = ["deepseek-v4.1-flash", "deepseek-v4-pro", "qwen3.7-plus"].find((m) => OPENAI_OK.includes(m)) || MODELS[0];

export function pickSpecialist(tipo, primary) {
  const t = String(tipo || "").toLowerCase();
  if (t.includes("vision") || t.includes("immagin")) return VISION_FALLBACK;
  if (t.includes("lung") || t.includes("long")) return LONG_MODEL === primary ? EXPERT_MODEL : LONG_MODEL;
  if (t.includes("verif") || t.includes("controll")) return VERIFY_MODEL === primary ? EXPERT_MODEL : VERIFY_MODEL;
  return EXPERT_MODEL === primary ? VERIFY_MODEL : EXPERT_MODEL;
}
