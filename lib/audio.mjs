// Dettatura locale: worker Python persistente (faster-whisper) + cache audio.
import path from "node:path";
import crypto from "node:crypto";
import { spawn } from "node:child_process";
import { settings as SETTINGS } from "./config.mjs";
import { logErr } from "./log.mjs";
import { projectRoot, PY_ENV, cachePut } from "./util.mjs";

const ROOT = projectRoot(import.meta.url);
const TRANSCRIBE_PY = path.join(ROOT, "transcribe.py");
const WHISPER_MODEL = SETTINGS.whisperModel || "large-v3-turbo";
const WHISPER_TIMEOUT_MS = Math.max(30000, Number(process.env.MATHAPP_WHISPER_TIMEOUT_MS) || 30 * 60 * 1000);
const WHISPER_IDLE_MS = Math.max(1000, Number(process.env.MATHAPP_WHISPER_IDLE_MS) || 2 * 60 * 60 * 1000);
let WHISPER_LANG = SETTINGS.whisperLanguage || "it";

export const AUDIO_EXT = /\.(mp3|wav|m4a|m4b|ogg|oga|opus|flac|webm|aac|wma|amr|3gp|mp4)$/i;
export const isAudio = (name, mime) => String(mime || "").startsWith("audio/") || AUDIO_EXT.test(String(name || ""));

const audioCache = new Map();
let whisperWorker = null;
let whisperQueue = Promise.resolve();

function whisperSettle(worker, value) {
  const pending = worker.pending;
  if (!pending) return;
  worker.pending = null;
  clearTimeout(pending.timer);
  pending.resolve(value);
}

function whisperStop(worker) {
  clearTimeout(worker.idleTimer);
  worker.idleTimer = null;
  if (whisperWorker === worker) whisperWorker = null;
  try { worker.proc.stdin.write(JSON.stringify({ cmd: "exit" }) + "\n"); } catch {}
  try { worker.proc.kill(); } catch {}
  whisperSettle(worker, { ok: false, error: "trascrizione interrotta" });
}

export function setWhisperLanguage(lang) {
  const next = String(lang || "it");
  if (next === WHISPER_LANG) return;
  WHISPER_LANG = next;
  if (whisperWorker) whisperStop(whisperWorker);
}

function getWhisperWorker() {
  if (whisperWorker && whisperWorker.proc.exitCode === null && !whisperWorker.proc.killed) return whisperWorker;
  const proc = spawn("python", [TRANSCRIBE_PY, "--worker", WHISPER_MODEL, WHISPER_LANG], { windowsHide: true, env: PY_ENV, stdio: ["pipe", "pipe", "pipe"] });
  const worker = { proc, buf: "", errTail: "", pending: null, idleTimer: null, seq: 0 };
  proc.stdout.on("data", (d) => {
    worker.buf += d.toString("utf8");
    let i;
    while ((i = worker.buf.indexOf("\n")) >= 0) {
      const line = worker.buf.slice(0, i).trim();
      worker.buf = worker.buf.slice(i + 1);
      if (!line) continue;
      let msg = null;
      try { msg = JSON.parse(line); } catch { continue; }
      if (msg.ready) {
        logErr(`whisper worker pronto: modello ${msg.model}, lingua ${msg.language}`);
        if (!worker.pending) {
          clearTimeout(worker.idleTimer);
          worker.idleTimer = setTimeout(() => whisperStop(worker), WHISPER_IDLE_MS);
        }
        continue;
      }
      whisperSettle(worker, msg);
    }
  });
  proc.stderr.on("data", (d) => { worker.errTail = (worker.errTail + d.toString("utf8")).slice(-2000); });
  proc.on("error", (e) => { whisperSettle(worker, { ok: false, error: "impossibile avviare faster-whisper: " + e.message }); });
  proc.on("exit", () => {
    clearTimeout(worker.idleTimer);
    worker.idleTimer = null;
    if (whisperWorker === worker) whisperWorker = null;
    whisperSettle(worker, { ok: false, error: "processo Whisper terminato" + (worker.errTail ? ": " + worker.errTail.slice(-300) : "") });
  });
  whisperWorker = worker;
  return worker;
}

function runWhisper(b64) {
  const run = whisperQueue.catch(() => {}).then(() => new Promise((resolve) => {
    const worker = getWhisperWorker();
    if (worker.pending) { resolve({ ok: false, error: "trascrizione gia' in corso" }); return; }
    clearTimeout(worker.idleTimer);
    worker.idleTimer = null;
    const id = ++worker.seq;
    const timer = setTimeout(() => {
      worker.pending = null;
      whisperStop(worker);
      resolve({ ok: false, error: "trascrizione: tempo limite superato" });
    }, WHISPER_TIMEOUT_MS);
    worker.pending = { id, timer, resolve };
    try {
      worker.proc.stdin.write(JSON.stringify({ id, b64 }) + "\n");
    } catch (e) {
      clearTimeout(timer);
      worker.pending = null;
      resolve({ ok: false, error: "invio audio fallito: " + e.message });
    }
  }));
  whisperQueue = run.then((r) => {
    const worker = whisperWorker;
    if (worker && !worker.pending && !worker.proc.killed) {
      clearTimeout(worker.idleTimer);
      worker.idleTimer = setTimeout(() => whisperStop(worker), WHISPER_IDLE_MS);
    }
    return r;
  }, () => {});
  return run;
}

// Scaldare il modello quando si apre l'app: la prima dettatura non paga il caricamento.
let whisperPreloadAt = 0;
export function maybePreloadWhisper() {
  if (process.env.MATHAPP_NO_WHISPER === "1") return;
  if (Date.now() - whisperPreloadAt < 5 * 60 * 1000) return;
  whisperPreloadAt = Date.now();
  try { getWhisperWorker(); } catch (e) { logErr("preload whisper: " + e.message); }
}

export async function audioToText(b64) {
  const key = crypto.createHash("sha1").update(b64).digest("hex");
  if (audioCache.has(key)) return audioCache.get(key);
  const t = await runWhisper(b64);
  cachePut(audioCache, key, t);
  return t;
}
