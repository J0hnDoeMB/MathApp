// Regression test: two servers must not share the same data directory.
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import fs from "node:fs";
import http from "node:http";
import net from "node:net";
import os from "node:os";
import path from "node:path";

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1")), "..");
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "mathapp-lock-"));
const dataDir = path.join(tmp, "data");
const settingsFile = path.join(tmp, "settings.json");
const authFile = path.join(tmp, "noauth.json");
fs.writeFileSync(settingsFile, JSON.stringify({ provider: "openrouter", mode: "core" }), "utf8");

function freePort() {
  return new Promise((resolve, reject) => {
    const s = net.createServer();
    s.listen(0, "127.0.0.1", () => { const p = s.address().port; s.close(() => resolve(p)); });
    s.on("error", reject);
  });
}
function request(port, method, pathname) {
  return new Promise((resolve, reject) => {
    const req = http.request({ host: "127.0.0.1", port, method, path: pathname }, (res) => {
      let b = "";
      res.on("data", (c) => (b += c));
      res.on("end", () => resolve({ status: res.statusCode, body: b }));
    });
    req.on("error", reject);
    req.end();
  });
}
function start(port) {
  const child = spawn(process.execPath, ["server.mjs"], {
    cwd: root,
    env: {
      ...process.env,
      MATHAPP_PORT: String(port),
      MATHAPP_SETTINGS_FILE: settingsFile,
      MATHAPP_AUTH_FILE: authFile,
      MATHAPP_DATA_DIR: dataDir,
      MATHAPP_BACKUP_DIR: path.join(tmp, "backups"),
      MATHAPP_TRACE_DIR: path.join(tmp, "logs"),
      MATHAPP_NO_WHISPER: "1",
      MATHAPP_TEST_SHUTDOWN: "1",
    },
    stdio: ["ignore", "pipe", "pipe"],
    windowsHide: true,
  });
  let log = "";
  child.stdout.on("data", (c) => (log += c));
  child.stderr.on("data", (c) => (log += c));
  return { child, getLog: () => log };
}
async function waitReady(port, proc) {
  for (let i = 0; i < 60; i++) {
    if (proc.child.exitCode !== null) throw new Error("server exited early: " + proc.getLog());
    try { if ((await request(port, "GET", "/api/settings")).status === 200) return; } catch {}
    await new Promise((r) => setTimeout(r, 150));
  }
  throw new Error("server not ready: " + proc.getLog());
}
async function stop(port, proc) {
  try { await request(port, "POST", "/__test_shutdown"); } catch {}
  if (proc.child.exitCode === null) {
    await Promise.race([once(proc.child, "exit"), new Promise((r) => setTimeout(r, 2000))]);
  }
  if (proc.child.exitCode === null) proc.child.kill();
}
let ok = 0, fail = 0;
function chk(name, cond, extra = "") { if (cond) { console.log("OK   " + name); ok++; } else { console.error("FAIL " + name + (extra ? " | " + extra : "")); fail++; } }

let first, second, third;
const p1 = await freePort();
const p2 = await freePort();
const p3 = await freePort();
try {
  first = start(p1);
  await waitReady(p1, first);
  chk("first instance starts", first.child.exitCode === null);

  second = start(p2);
  const exited = await Promise.race([once(second.child, "exit"), new Promise((r) => setTimeout(() => r(null), 4000))]);
  chk("second instance refuses the same data directory", !!exited && second.child.exitCode === 1, second.getLog().slice(-500));
  chk("lock error names the owner", /another instance|PID/.test(second.getLog()));
  chk("first instance stays healthy", (await request(p1, "GET", "/api/settings")).status === 200);
  await stop(p1, first);
  chk("first instance releases the lock on shutdown", first.child.exitCode === 0, first.getLog().slice(-300));

  third = start(p3);
  await waitReady(p3, third);
  chk("third instance starts after release", (await request(p3, "GET", "/api/settings")).status === 200);
} finally {
  if (first) await stop(p1, first);
  if (second && second.child.exitCode === null) second.child.kill();
  if (third) await stop(p3, third);
  try { fs.rmSync(tmp, { recursive: true, force: true }); } catch {}
}
console.log("----");
console.log("OK=" + ok + " FAIL=" + fail);
if (fail) process.exit(1);
