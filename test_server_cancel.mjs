import assert from "node:assert/strict";
import { spawn, execFileSync } from "node:child_process";
import { once } from "node:events";
import http from "node:http";
import fs from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";
import os from "node:os";

const tempRoot = os.tmpdir();
const testDir = path.join(tempRoot, "mathapp-cancel-" + crypto.randomUUID());
await fs.mkdir(testDir, { recursive: true });
await fs.copyFile(new URL("./server.mjs", import.meta.url), path.join(testDir, "server.mjs"));
await fs.copyFile(new URL("./sympy_cli.py", import.meta.url), path.join(testDir, "sympy_cli.py"));
await fs.copyFile(new URL("./transcribe.py", import.meta.url), path.join(testDir, "transcribe.py"));
await fs.cp(new URL("./lib", import.meta.url), path.join(testDir, "lib"), { recursive: true });
const legacyId = "legacy-" + crypto.randomUUID();
const revisionId = "revision-" + crypto.randomUUID();
const legacyFigure = { fid: "legacy-figure", title: "Figura legacy", commands: ["A=(1,2)"], msgIdx: 0 };
const convDir = path.join(testDir, "data", "conversations");
await fs.mkdir(convDir, { recursive: true });
await fs.writeFile(path.join(convDir, legacyId + ".json"), JSON.stringify({
  id: legacyId,
  title: "Sessione legacy",
  createdAt: Date.now(),
  updatedAt: Date.now(),
  model: "deepseek-v4.1-flash",
  messages: [],
  ggb: "BASE64_DA_CANCELLARE",
  cells: [],
  figures: [legacyFigure],
  mode: "figure",
  // `figsIssued` non c'era nelle versioni precedenti del formato.
}));
await fs.writeFile(path.join(convDir, revisionId + ".json"), JSON.stringify({
  id: revisionId,
  title: "Sessione revisionata",
  createdAt: Date.now(),
  updatedAt: Date.now(),
  model: "deepseek-v4.1-flash",
  messages: [],
  ggb: null,
  cells: [],
  figures: [],
  mode: "figure",
  stateRevision: 10,
}));

const portProbe = http.createServer();
await new Promise((resolve, reject) => {
  portProbe.once("error", reject);
  portProbe.listen(0, "127.0.0.1", resolve);
});
const appPort = portProbe.address().port;
await new Promise((resolve) => portProbe.close(resolve));

const bootstrap = `
import http from "node:http";
import { pathToFileURL } from "node:url";
const requestedPort = ${appPort};
const originalCreateServer = http.createServer.bind(http);
let testServer;
http.createServer = (handler) => {
  testServer = originalCreateServer((req, res) => {
    if (req.url === "/__test_release") {
      try { globalThis.__testStreamController?.close(); } catch {}
      res.end("released");
      return;
    }
    if (req.url === "/__test_shutdown") {
      res.end("shutdown");
      setTimeout(() => process.exit(0), 50);
      return;
    }
    handler(req, res);
  });
  return testServer;
};
const originalListen = http.Server.prototype.listen;
http.Server.prototype.listen = function (...args) {
  if (args[0] === 8790) {
    args[0] = requestedPort;
  }
  return originalListen.apply(this, args);
};
const originalFetch = globalThis.fetch;
globalThis.fetch = async (input, init = {}) => {
  if (String(input) === "https://opencode.ai/zen/go/v1/chat/completions") {
    const signal = init.signal;
    return new Response(new ReadableStream({
      start(controller) {
        globalThis.__testStreamController = controller;
        controller.enqueue(new TextEncoder().encode('data: {"choices":[{"delta":{"content":"PARZIALE"}}]}\\n\\n'));
        const onAbort = () => {
          process.stdout.write("TEST_UPSTREAM_ABORTED\\n");
          try { controller.error(new DOMException("test abort", "AbortError")); } catch {}
        };
        if (signal) {
          if (signal.aborted) onAbort();
          else signal.addEventListener("abort", onAbort, { once: true });
        }
      },
    }), { status: 200, headers: { "Content-Type": "text/event-stream" } });
  }
  return originalFetch(input, init);
};
await import(pathToFileURL(path.join(process.cwd(), "server.mjs")).href);
`;

const child = spawn(process.execPath, ["--input-type=module", "-e", bootstrap], {
  cwd: testDir,
  windowsHide: true,
  env: { ...process.env, MATHAPP_SYMPY_TIMEOUT_MS: "1", MATHAPP_WHISPER_IDLE_MS: "4000" },
  stdio: ["ignore", "pipe", "pipe"],
});
let stdout = "", stderr = "";
child.stdout.on("data", (chunk) => { stdout += chunk.toString(); });
child.stderr.on("data", (chunk) => { stderr += chunk.toString(); });
const base = `http://127.0.0.1:${appPort}`;
const conversationId = "cancel-test-" + crypto.randomUUID();

async function waitFor(predicate, message, timeoutMs = 12000) {
  const end = Date.now() + timeoutMs;
  while (Date.now() < end) {
    if (predicate()) return;
    if (child.exitCode !== null) throw new Error(`server exited ${child.exitCode}: ${stderr}`);
    await new Promise((resolve) => setTimeout(resolve, 40));
  }
  throw new Error(`${message}; stdout=${stdout}; stderr=${stderr}`);
}

function countTempWorkers() {
  const pattern = "*" + testDir + "*transcribe.py*--worker*";
  const script = "(Get-CimInstance Win32_Process | Where-Object { $_.Name -like 'python*' -and $_.CommandLine -like '" + pattern + "' } | Measure-Object).Count";
  return Number(execFileSync("powershell.exe", ["-NoProfile", "-Command", script], { encoding: "utf8" }).trim());
}

try {
  const startDeadline = Date.now() + 15000;
  let started = false;
  while (Date.now() < startDeadline) {
    try {
      const response = await fetch(base + "/api/models", { signal: AbortSignal.timeout(500) });
      if (response.ok) { started = true; break; }
    } catch {}
    if (child.exitCode !== null) break;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  assert.ok(started, `test server did not start: ${stdout} ${stderr}`);

  const timedCompute = await fetch(base + "/api/compute", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ operation: "simplify", expr: "x^2+1" }),
  }).then((r) => r.json());
  assert.equal(timedCompute.ok, false, "il subprocess SymPy deve rispettare il timeout del server");
  assert.match(timedCompute.error || "", /tempo limite/i);

  const stateResponse = await fetch(base + "/api/conversation/state", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ id: legacyId, ggb: null, cells: [], mode: "algebra", figures: [legacyFigure] }),
  });
  assert.equal(stateResponse.status, 200);
  const legacy = await fetch(base + "/api/conversation?id=" + encodeURIComponent(legacyId)).then((r) => r.json());
  assert.equal(legacy.ggb, null, "ggb:null deve cancellare lo stato GeoGebra salvato");
  assert.deepEqual(legacy.figures, [{ ...legacyFigure, view: "2d" }], "il primo salvataggio non deve eliminare figure legacy non emesse nella sessione corrente");

  const postState = (revision, expr) => fetch(base + "/api/conversation/state", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ id: revisionId, revision, ggb: null, cells: [{ op: "factor", expr, res: { ok: true, result: expr } }], mode: "algebra", figures: [] }),
  });
  await postState(12, "x^2-new");
  await postState(11, "x^2-stale");
  const versioned = await fetch(base + "/api/conversation?id=" + encodeURIComponent(revisionId)).then((r) => r.json());
  assert.equal(versioned.stateRevision, 12, "il server deve mantenere la revisione più recente");
  assert.equal(versioned.cells[0].expr, "x^2-new", "uno snapshot vecchio arrivato tardi non deve sovrascrivere il più nuovo");

  // Il worker Whisper si avvia su richiesta e si spegne da solo dopo l'inattività.
  const audioPath = process.env.MATHAPP_TEST_AUDIO;
  const hasAudio = audioPath && await fs.access(audioPath).then(() => true).catch(() => false);
  if (hasAudio) {
    const lezione = (await fs.readFile(audioPath)).toString("base64");
    const whisperResult = await fetch(base + "/api/transcribe", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ b64: lezione }),
    }).then((r) => r.json());
    assert.ok(whisperResult.ok, "trascrizione: " + JSON.stringify(whisperResult).slice(0, 200));
    assert.match(whisperResult.text || "", /derivata/i);
    assert.equal(whisperResult.language, "it");
    await waitFor(() => countTempWorkers() === 1, "il worker Whisper non è rimasto attivo dopo la trascrizione", 8000);
    await waitFor(() => countTempWorkers() === 0, "il worker Whisper non si è spento dopo l'inattività", 20000);
  } else {
    console.log("SKIP whisper: imposta MATHAPP_TEST_AUDIO con un file audio di prova.");
  }

  const abort = new AbortController();
  const response = await fetch(base + "/api/chat", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    signal: abort.signal,
    body: JSON.stringify({
      model: "deepseek-v4.1-flash",
      sessionId: conversationId,
      conversationId,
      messages: [{ role: "user", content: "annulla questo turno di prova" }],
    }),
  });
  assert.equal(response.status, 200);
  const reader = response.body.getReader();
  const deadline = Date.now() + 10000;
  let stream = "";
  while (!stream.includes("PARZIALE") && Date.now() < deadline) {
    const next = await Promise.race([
      reader.read(),
      new Promise((_, reject) => setTimeout(() => reject(new Error("SSE timeout")), 5000)),
    ]);
    if (next.done) break;
    stream += new TextDecoder().decode(next.value);
  }
  assert.match(stream, /PARZIALE/, "il client deve ricevere il primo evento SSE prima di annullare");
  abort.abort();
  try { await reader.read(); } catch {}

  await waitFor(() => stdout.includes("TEST_UPSTREAM_ABORTED"), "l'annullamento HTTP non ha fermato l'upstream");
  await new Promise((resolve) => setTimeout(resolve, 150));
  const saved = await fetch(base + "/api/conversation?id=" + encodeURIComponent(conversationId));
  assert.equal(saved.status, 404, "un turno annullato non deve salvare una conversazione parziale");

  // /api/explain risponde in streaming (upstream simulato). L'upstream del test
  // resta aperto apposta per il test di annullamento: leggo il primo evento e annullo.
  const explainRes = await fetch(base + "/api/explain", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ op: "factor", expr: "x^2-9", result: "(x - 3)*(x + 3)" }),
  });
  assert.equal(explainRes.status, 200);
  const explainReader = explainRes.body.getReader();
  let explainChunk = "";
  const explainDeadline = Date.now() + 8000;
  while (!explainChunk.includes("PARZIALE") && Date.now() < explainDeadline) {
    const next = await Promise.race([
      explainReader.read(),
      new Promise((_, reject) => setTimeout(() => reject(new Error("explain timeout")), 5000)),
    ]);
    if (next.done) break;
    explainChunk += new TextDecoder().decode(next.value);
  }
  assert.match(explainChunk, /event: delta/, "la spiegazione arriva in streaming");
  assert.match(explainChunk, /PARZIALE/, "i delta del modello finiscono nel flusso");
  try { await explainReader.cancel(); } catch {}

  console.log("PASS: abort client propagato all'upstream e nessuna conversazione parziale salvata");
} finally {
  try { await fetch(base + "/__test_release", { signal: AbortSignal.timeout(1000) }); } catch {}
  try { await fetch(base + "/__test_shutdown", { signal: AbortSignal.timeout(1000) }); } catch {}
  if (child.exitCode === null) await Promise.race([once(child, "exit"), new Promise((resolve) => setTimeout(resolve, 3000))]);
  if (child.exitCode === null) { child.kill(); await Promise.race([once(child, "exit"), new Promise((resolve) => setTimeout(resolve, 1500))]); }
  await fs.rm(testDir, { recursive: true, force: true });
}
