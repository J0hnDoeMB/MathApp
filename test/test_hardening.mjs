// Hardening smoke test: crash paths, security headers, CDN pinning,
// attachment serving, private file modes and request timeouts.
import { spawn } from "node:child_process";
import http from "node:http";
import net from "node:net";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { serveStatic } from "../lib/http.mjs";
import { fetchWithTimeout } from "../lib/util.mjs";

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1")), "..");
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "mathapp-hard-"));
const settingsFile = path.join(tmp, "settings.json");
const authFile = path.join(tmp, "noauth.json");
const dataDir = path.join(tmp, "data");
const backupDir = path.join(tmp, "backups");
fs.writeFileSync(settingsFile, JSON.stringify({ mode: "full", provider: "openrouter", backup: true }));

function freePort() {
  return new Promise((resolve, reject) => {
    const s = net.createServer();
    s.listen(0, "127.0.0.1", () => { const p = s.address().port; s.close(() => resolve(p)); });
    s.on("error", reject);
  });
}
function request(port, method, pathname, { headers, body } = {}) {
  return new Promise((resolve, reject) => {
    const req = http.request({ host: "127.0.0.1", port, method, path: pathname, headers: headers || {} }, (res) => {
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
    try { const r = await request(port, "GET", "/api/settings"); if (r.status === 200) return; } catch {}
    await new Promise((r) => setTimeout(r, 200));
  }
  throw new Error("server non pronto");
}
function rawRequest(port, payload, timeout = 4000) {
  return new Promise((resolve) => {
    const socket = net.connect(port, "127.0.0.1", () => socket.write(payload));
    let data = "";
    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      try { socket.destroy(); } catch {}
      const m = data.match(/^HTTP\/1\.1 (\d{3})/);
      resolve({ status: m ? Number(m[1]) : 0, raw: data });
    };
    const timer = setTimeout(finish, timeout);
    socket.on("data", (c) => (data += c));
    socket.on("end", finish);
    socket.on("close", finish);
    socket.on("error", finish);
  });
}
const checks = [];
function chk(name, cond, extra = "") {
  checks.push({ name, ok: !!cond, extra });
  if (!cond) console.error("FAIL " + name + (extra ? " | " + extra : ""));
}

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
  },
  stdio: ["ignore", "pipe", "pipe"],
  windowsHide: true,
});
let log = "";
child.stdout.on("data", (c) => (log += c));
child.stderr.on("data", (c) => (log += c));

try {
  await waitReady(port);
  const base = `http://127.0.0.1:${port}`;

  // 1. Security headers on HTML and API responses.
  const home = await request(port, "GET", "/");
  const csp = String(home.headers["content-security-policy"] || "");
  chk("GET / -> 200", home.status === 200);
  chk("CSP presente", /default-src 'self'/.test(csp) && /object-src 'none'/.test(csp) && /frame-ancestors 'none'/.test(csp), csp);
  chk("CSP consente le CDN usate", /cdn\.jsdelivr\.net/.test(csp) && /geogebra\.org/.test(csp), csp);
  chk("X-Content-Type-Options nosniff", home.headers["x-content-type-options"] === "nosniff");
  chk("X-Frame-Options DENY", home.headers["x-frame-options"] === "DENY");
  chk("Referrer-Policy no-referrer", home.headers["referrer-policy"] === "no-referrer");
  chk("Permissions-Policy presente", /camera=/.test(String(home.headers["permissions-policy"] || "")));
  const api = await request(port, "GET", "/api/settings");
  chk("header di sicurezza anche sulle API", api.headers["x-content-type-options"] === "nosniff" && api.headers["referrer-policy"] === "no-referrer");

  // 2. CDN pinning and SRI.
  const html = fs.readFileSync(path.join(root, "public", "index.html"), "utf8");
  chk("marked pinnato 18.1.1", /marked@18\.1\.1\/lib\/marked\.umd\.js/.test(html) && !/npm\/marked\/marked\.min\.js/.test(html));
  chk("marked con SRI", /marked@18\.1\.1[\s\S]{0,300}integrity="sha384-rATToyt6602Jnq8c7w8HZwmyOUgPL7mzxX01FBWoV48ns\/EgkakGozpES\+PnaYOI"/.test(html));
  chk("katex con SRI", /katex@0\.16\.9\/dist\/katex\.min\.js[\s\S]{0,300}integrity="sha384-XjKyOOlGwcjNTAIQHIpgOno0Hl1YQqzUOEleOLALmuqehneUG\+vnGctmUb0ZY0l8"/.test(html));
  chk("katex css con SRI", /katex@0\.16\.9\/dist\/katex\.min\.css[\s\S]{0,300}integrity="sha384-n8MVd4RsNIU0tAv4ct0nTaAbDJwPJzDEaqSD1odI\+WdtXRGWt2kTvGFasHpSy3SV"/.test(html));
  const appJs = fs.readFileSync(path.join(root, "public", "app.js"), "utf8");
  chk("GeoGebra codebase pinnata", /setHTML5Codebase\(["']https:\/\/www\.geogebra\.org\/apps\/5\.4\.\d+\.\d+\/web3d\/?"\)/.test(appJs));

  // 3. Malformed absolute-URI must not hang the server.
  const malformed = await rawRequest(port, "GET http://[ HTTP/1.1\r\nHost: 127.0.0.1\r\nConnection: close\r\n\r\n");
  chk("URL malformato -> 500 (non hang)", malformed.status === 500, malformed.raw.slice(0, 120));
  chk("server ancora vivo dopo URL malformato", (await request(port, "GET", "/api/settings")).status === 200);

  // 4. serveStatic must not write to an already-sent response.
  let staticWrites = 0;
  const fakeRes = {
    headersSent: true,
    writableEnded: false,
    destroyed: false,
    writeHead() { staticWrites++; return this; },
    end() { staticWrites++; return this; },
  };
  serveStatic(fakeRes, "/definitely-missing-file.txt");
  await new Promise((r) => setTimeout(r, 100));
  chk("serveStatic non scrive su response chiusa", staticWrites === 0, String(staticWrites));

  // 5. KB attachment serving cannot be turned into same-origin HTML.
  const save = await request(port, "POST", "/api/settings", {
    headers: { "Content-Type": "application/json", Origin: base },
    body: JSON.stringify({ mode: "full" }),
  });
  chk("settings full -> 200", save.status === 200);
  const evilHtml = Buffer.from("<html><script>window.PWN=1</script></html>").toString("base64");
  const addHtml = await request(port, "POST", "/api/kb/add", {
    headers: { "Content-Type": "application/json", Origin: base },
    body: JSON.stringify({ name: "evil.html", mime: "text/html", b64: evilHtml }),
  });
  chk("upload evil.html -> 200", addHtml.status === 200);
  const evilPng = Buffer.from("<html><script>window.PNG=1</script></html>").toString("base64");
  const addPng = await request(port, "POST", "/api/kb/add", {
    headers: { "Content-Type": "application/json", Origin: base },
    body: JSON.stringify({ name: "evil.png", mime: "text/html", b64: evilPng }),
  });
  chk("upload evil.png mime html -> 200", addPng.status === 200);
  const htmlId = JSON.parse(addHtml.body).doc.id;
  const pngId = JSON.parse(addPng.body).doc.id;
  const htmlFile = await request(port, "GET", `/api/kb/file?id=${encodeURIComponent(htmlId)}`);
  const pngFile = await request(port, "GET", `/api/kb/file?id=${encodeURIComponent(pngId)}`);
  chk("evil.html non servito come HTML", !/text\/html/i.test(String(htmlFile.headers["content-type"])) && /attachment/i.test(String(htmlFile.headers["content-disposition"])));
  chk("evil.html ha nosniff", htmlFile.headers["x-content-type-options"] === "nosniff");
  chk("evil.png non usa il mime del client", pngFile.headers["content-type"] === "image/png", String(pngFile.headers["content-type"]));
  chk("evil.png ha nosniff", pngFile.headers["x-content-type-options"] === "nosniff");

  // 6. Private permissions (POSIX only; Windows ACLs are checked manually).
  if (process.platform !== "win32") {
    const mode = (p) => fs.statSync(p).mode & 0o777;
    chk("settings.json 0600", mode(settingsFile) === 0o600, mode(settingsFile).toString(8));
    chk("data/ 0700", mode(dataDir) === 0o700, mode(dataDir).toString(8));
    const state = await request(port, "POST", "/api/conversation/state", {
      headers: { "Content-Type": "application/json", Origin: base },
      body: JSON.stringify({ id: "perm-test", revision: 1, cells: [], figures: [] }),
    });
    chk("conversation/state -> 200", state.status === 200);
    chk("conversation file 0600", mode(path.join(dataDir, "conversations", "perm-test.json")) === 0o600);
    await request(port, "GET", "/api/traces");
    chk("trace.jsonl 0600", mode(path.join(root, "logs", "trace.jsonl")) === 0o600);
    await request(port, "POST", "/api/backup", { headers: { "Content-Type": "application/json", Origin: base }, body: "{}" });
    const zips = fs.existsSync(backupDir) ? fs.readdirSync(backupDir).filter((f) => f.endsWith(".zip")) : [];
    chk("backup zip 0600", zips.length > 0 && mode(path.join(backupDir, zips[0])) === 0o600, zips[0] || "nessuno");
  } else {
    chk("permessi POSIX (skip su Windows)", true);
  }

  // 7. fetchWithTimeout aborts a hanging upstream.
  const hang = http.createServer(() => {});
  await new Promise((r) => hang.listen(0, "127.0.0.1", r));
  const hangPort = hang.address().port;
  const started = Date.now();
  let timeoutError = null;
  try {
    await fetchWithTimeout(`http://127.0.0.1:${hangPort}/`, {}, 150);
  } catch (e) {
    timeoutError = e;
  }
  hang.close();
  chk("fetchWithTimeout interrompe upstream appeso", !!timeoutError && /timeout/i.test(String(timeoutError.message)) && Date.now() - started < 2000, String(timeoutError && timeoutError.message));
} catch (e) {
  chk("hardening test senza eccezioni", false, String(e && e.stack || e));
} finally {
  try { await fetch(`http://127.0.0.1:${port}/__test_shutdown`, { method: "POST", signal: AbortSignal.timeout(1000) }); } catch {}
  await new Promise((r) => setTimeout(r, 600));
  if (child.exitCode === null) child.kill();
  await new Promise((r) => setTimeout(r, 300));
  try { fs.rmSync(tmp, { recursive: true, force: true }); } catch {}
}

const failed = checks.filter((c) => !c.ok);
for (const c of checks) console.log((c.ok ? "OK   " : "FAIL ") + c.name + (c.ok || !c.extra ? "" : " | " + c.extra));
console.log("----");
console.log(`OK=${checks.length - failed.length} FAIL=${failed.length}`);
if (failed.length) { console.error(log.slice(-1600)); process.exit(1); }
