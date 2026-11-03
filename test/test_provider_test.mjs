// Provider connection test: fake OpenRouter upstream, no real API calls.
import { spawn } from "node:child_process";
import http from "node:http";
import net from "node:net";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1")), "..");
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "mathapp-provider-"));
const settingsFile = path.join(tmp, "settings.json");
const authFile = path.join(tmp, "noauth.json");
const dataDir = path.join(tmp, "data");
const backupDir = path.join(tmp, "backups");
fs.writeFileSync(settingsFile, JSON.stringify({ provider: "openrouter", model: "deepseek-v4-flash", mode: "core", level: "auto" }), "utf8");

function freePort() {
  return new Promise((resolve, reject) => {
    const s = net.createServer();
    s.listen(0, "127.0.0.1", () => { const p = s.address().port; s.close(() => resolve(p)); });
    s.on("error", reject);
  });
}

function request(port, method, pathname, { origin, headers, body } = {}) {
  return new Promise((resolve, reject) => {
    const h = { ...(headers || {}) };
    if (origin) h.Origin = origin;
    const req = http.request({ host: "127.0.0.1", port, method, path: pathname, headers: h }, (res) => {
      let b = "";
      res.on("data", (c) => (b += c));
      res.on("end", () => resolve({ status: res.statusCode, body: b, headers: res.headers }));
    });
    req.on("error", reject);
    if (body !== undefined) req.write(body);
    req.end();
  });
}

async function waitReady(port) {
  for (let i = 0; i < 60; i++) {
    try { if ((await request(port, "GET", "/api/settings")).status === 200) return; } catch {}
    await new Promise((r) => setTimeout(r, 200));
  }
  throw new Error("server non pronto");
}

const upstreamPort = await freePort();
let upstreamMode = "ok";
let lastAuth = "";
let lastPayload = null;
const upstream = http.createServer((req, res) => {
  let b = "";
  req.on("data", (c) => (b += c));
  req.on("end", () => {
    try { lastPayload = JSON.parse(b); } catch { lastPayload = null; }
    lastAuth = String(req.headers.authorization || "");
    if (upstreamMode === "echo") {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ choices: [{ message: { role: "assistant", content: "OK " + lastAuth } }] }));
      return;
    }
    if (upstreamMode === "fail") {
      res.writeHead(401, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "invalid key: " + lastAuth }));
      return;
    }
    if (upstreamMode === "quiz") {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ choices: [{ message: { role: "assistant", content: '[{"d":"Derivata di x^2?","opts":["x","2x","x^2","2"],"ok":1,"why":"regola"}]' } }] }));
      return;
    }
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ choices: [{ message: { role: "assistant", content: "OK" } }] }));
  });
});
await new Promise((resolve, reject) => {
  upstream.listen(upstreamPort, "127.0.0.1", resolve);
  upstream.on("error", reject);
});

const port = await freePort();
const child = spawn(process.execPath, ["server.mjs"], {
  cwd: root,
  env: {
    ...process.env,
    MATHAPP_PORT: String(port),
    MATHAPP_SETTINGS_FILE: settingsFile,
    MATHAPP_AUTH_FILE: authFile,
    MATHAPP_DATA_DIR: dataDir,
    MATHAPP_BACKUP_DIR: backupDir,
    MATHAPP_NO_WHISPER: "1",
    MATHAPP_TEST_SHUTDOWN: "1",
    MATHAPP_OPENROUTER_URL: `http://127.0.0.1:${upstreamPort}/v1/chat/completions`,
  },
  stdio: ["ignore", "pipe", "pipe"],
  windowsHide: true,
});
let log = "";
child.stdout.on("data", (c) => (log += c));
child.stderr.on("data", (c) => (log += c));

let ok = 0, fail = 0;
function chk(name, cond, detail) {
  if (cond) { console.log("OK   " + name); ok++; }
  else { console.error("FAIL " + name + (detail ? " | " + detail : "")); fail++; }
}
const post = (body, extra = {}) => request(port, "POST", "/api/settings/test", {
  origin: extra.origin === undefined ? `http://127.0.0.1:${port}` : extra.origin,
  headers: { "Content-Type": "application/json" },
  body: typeof body === "string" ? body : JSON.stringify(body),
});

try {
  await waitReady(port);
  const base = `http://127.0.0.1:${port}`;
  const postSettings = (body) => request(port, "POST", "/api/settings", {
    origin: base,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

  const noKey = await post({ provider: "openrouter", model: "deepseek-v4-flash" });
  chk("test: senza chiave -> 400", noKey.status === 400 && /nessuna chiave/.test(noKey.body));
  const badProvider = await post({ provider: "altro", apiKey: "sk-test" });
  chk("test: provider invalido -> 400", badProvider.status === 400 && /provider non valido/.test(badProvider.body));
  const incompatible = await post({ provider: "openrouter", model: "space-bunny", apiKey: "sk-test" });
  chk("test: modello incompatibile -> 400", incompatible.status === 400 && /non disponibile/.test(incompatible.body), incompatible.body);
  const cross = await post({ provider: "openrouter", apiKey: "sk-test" }, { origin: "https://evil.example" });
  chk("test: cross-origin -> 403", cross.status === 403);
  const malformed = await post("{not-json");
  chk("test: JSON invalido -> 400", malformed.status === 400);

  const secret = "sk-or-v1-provider-test-secret";
  const good = await post({ provider: "openrouter", model: "deepseek-v4-flash", apiKey: secret });
  const gj = JSON.parse(good.body);
  chk("test: connessione OK", good.status === 200 && gj.ok === true && gj.provider === "openrouter" && gj.model === "deepseek-v4-flash" && gj.mappedModel === "deepseek/deepseek-v4-flash" && Number.isFinite(gj.latencyMs) && gj.reply === "OK", good.body);
  upstreamMode = "echo";
  const echoed = await post({ provider: "openrouter", model: "deepseek-v4-flash", apiKey: secret });
  chk("test: chiave usata ma non salvata", lastAuth === "Bearer " + secret && !good.body.includes(secret) && !echoed.body.includes(secret) && echoed.body.includes("***") && JSON.parse((await request(port, "GET", "/api/settings")).body).hasKey === false, echoed.body);
  upstreamMode = "ok";
  chk("test: routing OpenRouter applicato", !!lastPayload && lastPayload.provider && Array.isArray(lastPayload.provider.order) && lastPayload.provider.order[0] === "Morph" && lastPayload.max_tokens === 16);

  upstreamMode = "fail";
  const bad = await post({ provider: "openrouter", model: "deepseek-v4-flash", apiKey: secret });
  const bj = JSON.parse(bad.body);
  chk("test: upstream 401 -> 502", bad.status === 502 && bj.ok === false && /HTTP 401/.test(bj.error));
  chk("test: errore non espone la chiave", !bad.body.includes(secret) && bad.body.includes("***"), bad.body);

  const tooLong = await post({ provider: "openrouter", model: "deepseek-v4-flash", apiKey: "x".repeat(501) });
  chk("test: chiave troppo lunga -> 400", tooLong.status === 400 && /troppo lunga/.test(tooLong.body));

  const saved = await postSettings({ provider: "openrouter", model: "deepseek-v4-flash", apiKey: secret });
  chk("settings: chiave salvata", saved.status === 200 && JSON.parse(saved.body).hasKey === true, saved.body);
  const opencodeModels = JSON.parse((await request(port, "GET", "/api/models?provider=opencode")).body);
  chk("models: OpenCode include space-bunny", opencodeModels.provider === "opencode" && opencodeModels.models.includes("space-bunny") && opencodeModels.hasKey === false, JSON.stringify(opencodeModels));
  const orModels = JSON.parse((await request(port, "GET", "/api/models?provider=openrouter")).body);
  chk("models: OpenRouter mappa solo i compatibili", orModels.provider === "openrouter" && !orModels.models.includes("space-bunny") && orModels.hasKey === true, JSON.stringify(orModels));

  const beforeSave = JSON.parse((await request(port, "GET", "/api/settings")).body);
  const partial = await postSettings({ mode: "full", provider: "openrouter", model: "space-bunny" });
  const afterSave = JSON.parse((await request(port, "GET", "/api/settings")).body);
  chk("settings: errore non muta lo stato", partial.status === 400 && afterSave.mode === beforeSave.mode && afterSave.model === beforeSave.model, partial.body + " | " + JSON.stringify(afterSave));

  const toOpenCode = await postSettings({ provider: "opencode", model: "space-bunny" });
  const toOpenCodeBody = JSON.parse(toOpenCode.body);
  chk("settings: cambio provider non riusa la chiave precedente", toOpenCode.status === 200 && toOpenCodeBody.hasKey === false, toOpenCode.body);
  const toOR = await postSettings({ provider: "openrouter" });
  const toORBody = JSON.parse(toOR.body);
  chk("settings: cambio provider sceglie modello compatibile", toOpenCode.status === 200 && toOR.status === 200 && toORBody.provider === "openrouter" && toORBody.model !== "space-bunny", toOR.body);

  await postSettings({ mode: "full", provider: "openrouter", model: "qwen3.8-flash", apiKey: secret });
  upstreamMode = "quiz";
  const quizRes = await request(port, "POST", "/api/quiz", {
    origin: base,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ topic: "derivate", n: 3 }),
  });
  const quizBody = JSON.parse(quizRes.body);
  upstreamMode = "ok";
  chk("study: /api/quiz usa il modello configurato per il provider", quizRes.status === 200 && quizBody.ok === true && quizBody.model === "qwen3.8-flash" && lastPayload && lastPayload.model === "qwen/qwen3.8-flash", quizRes.body);
} finally {
  try { await fetch(`http://127.0.0.1:${port}/__test_shutdown`, { method: "POST", signal: AbortSignal.timeout(1000) }); } catch {}
  await new Promise((r) => setTimeout(r, 600));
  if (child.exitCode === null) child.kill();
  await new Promise((r) => setTimeout(r, 300));
  await new Promise((resolve) => upstream.close(resolve));
  try { fs.rmSync(tmp, { recursive: true, force: true }); } catch {}
}

console.log("----");
console.log(`OK=${ok} FAIL=${fail}`);
if (fail) {
  console.error(log.slice(-1200));
  process.exit(1);
}
