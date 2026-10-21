// Documenti e allegati: estrazione PDF, testo, audio e costruzione dei messaggi upstream.
import path from "node:path";
import crypto from "node:crypto";
import { spawn } from "node:child_process";
import { projectRoot, PY_ENV, cachePut } from "./util.mjs";
import { audioToText, isAudio } from "./audio.mjs";

const ROOT = projectRoot(import.meta.url);
const EXTRACT_PY = path.join(ROOT, "extract.py");
const pdfCache = new Map();

function runPdf(b64, timeoutMs = Number(process.env.MATHAPP_PDF_TIMEOUT_MS) || 30000) {
  return new Promise((resolve) => {
    const p = spawn("python", [EXTRACT_PY], { windowsHide: true, env: PY_ENV });
    let out = "", err = "", settled = false;
    const done = (value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(value);
    };
    const timer = setTimeout(() => {
      try { p.kill(); } catch {}
      done({ ok: false, error: "timeout estrazione PDF" });
    }, timeoutMs);
    p.stdout.on("data", (d) => (out += d));
    p.stderr.on("data", (d) => (err += d));
    p.on("close", () => {
      const line = out.trim().split("\n").filter(Boolean).pop() || "";
      try { done(JSON.parse(line)); }
      catch { done({ ok: false, error: "uscita non valida: " + out.slice(-160) + " " + err.slice(-120) }); }
    });
    p.on("error", () => done({ ok: false, error: "impossibile avviare l'estrazione PDF" }));
    try { p.stdin.write(b64); p.stdin.end(); } catch { done({ ok: false, error: "invio PDF fallito" }); }
  });
}

export async function docToText(name, mime, b64) {
  if (String(mime).includes("pdf")) {
    const key = crypto.createHash("sha1").update(b64).digest("hex");
    if (pdfCache.has(key)) return pdfCache.get(key);
    const r = await runPdf(b64);
    cachePut(pdfCache, key, r);
    return r;
  }
  try { return { ok: true, text: Buffer.from(b64, "base64").toString("utf8").replace(/^\uFEFF/, "") }; }
  catch { return { ok: false, error: "file non decodificabile come testo" }; }
}

// Trasforma i messaggi del client in messaggi per il modello, con gli allegati.
export async function buildUpstream(rawMsgs) {
  const out = [];
  const notices = [];
  const collected = [];
  for (const m of rawMsgs) {
    const atts = m.role === "user" && Array.isArray(m.attachments) ? m.attachments.slice(0, 4) : [];
    if (!atts.length) { out.push({ role: m.role, content: m.content }); continue; }
    const images = [];
    const docs = [];
    for (const a of atts) {
      const mime = String(a.mime || "");
      if (isAudio(a.name, mime)) {
        const t = await audioToText(a.b64);
        if (t && t.ok && t.text) {
          const conf = Math.round((t.language_probability || 0) * 100);
          docs.push(`### Trascrizione audio: ${a.name}\n(lingua ${t.language}, confidenza ${conf}%, durata ${t.duration}s, Whisper ${t.model})\n\`\`\`\n${String(t.text).slice(0, 40000)}\n\`\`\``);
          notices.push(`Audio "${a.name}" trascritto in locale (Whisper ${t.model}): lingua ${t.language} ${conf}%, ${t.duration}s.`);
          collected.push({ name: a.name, kind: "audio", text: String(t.text), b64: a.b64, mime });
        } else {
          notices.push(`Trascrizione di "${a.name}" non riuscita: ${(t && t.error) || "errore"}.`);
        }
      } else if (mime.startsWith("image/")) {
        images.push({ type: "image_url", image_url: { url: `data:${mime};base64,${a.b64}` } });
      } else {
        const t = await docToText(a.name, mime, a.b64);
        if (t && t.ok) {
          docs.push(`### Allegato: ${a.name}\n\`\`\`\n${String(t.text || "").slice(0, 60000)}\n\`\`\``);
          notices.push(`Allegato "${a.name}" letto (${String(t.text || "").length} caratteri).`);
          collected.push({ name: a.name, kind: String(mime).includes("pdf") ? "pdf" : "testo", text: String(t.text || ""), b64: a.b64, mime });
        } else {
          notices.push(`Allegato "${a.name}" non leggibile: ${(t && t.error) || "errore"}.`);
        }
      }
    }
    let text = m.content || "";
    if (docs.length) text += "\n\n" + docs.join("\n\n");
    out.push(images.length ? { role: "user", content: [{ type: "text", text }, ...images] } : { role: "user", content: text });
  }
  return { msgs: out, notices, collected };
}
