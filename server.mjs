// MathApp server - guscio HTTP: sicurezza, route API, statici e avvio.
import http from "node:http";
import { settings as SETTINGS, getKey } from "./lib/config.mjs";
import { guardRequest } from "./lib/security.mjs";
import { logErr } from "./lib/log.mjs";
import { scheduleBackups } from "./lib/storage.mjs";
import { maybePreloadWhisper } from "./lib/audio.mjs";
import { serveStatic } from "./lib/http.mjs";
import { handleApi, prepareApi } from "./routes/index.mjs";
import { isOptionalApi } from "./lib/features.mjs";
import { newId, trace } from "./lib/observability.mjs";
import { acquireInstanceLock } from "./lib/instance-lock.mjs";

const PORT = Number(process.env.MATHAPP_PORT) || 8790;
const isFullMode = () => SETTINGS.mode === "full";
const instanceLock = acquireInstanceLock({ port: PORT });
if (!instanceLock.ok) {
  console.error("MathApp: " + instanceLock.error + ". Close the other instance or set MATHAPP_DATA_DIR to a different directory.");
  process.exit(1);
}

// ---------- http ----------
const server = http.createServer(async (req, res) => {
  try {
  const url = new URL(req.url, "http://127.0.0.1");
  const reqId = newId("req");
  req.mathappId = reqId;
  try { res.setHeader("X-Request-Id", reqId); } catch {}
  const started = Date.now();
  res.on("finish", () => {
    if (url.pathname.startsWith("/api/")) trace("http", { id: reqId, method: req.method, path: url.pathname, status: res.statusCode, ms: Date.now() - started });
  });
  // Test seam used by c8/browser cleanup so child-server coverage is flushed.
  if (process.env.MATHAPP_TEST_SHUTDOWN === "1" && req.method === "POST" && url.pathname === "/__test_shutdown") {
    res.writeHead(200, { "Content-Type": "text/plain" });
    res.end("shutdown");
    setTimeout(shutdown, 25);
    return;
  }
  const prep = await prepareApi(url.pathname, isFullMode());
  if (!prep.ok) {
    res.writeHead(500, { "Content-Type": "application/json" });
    return res.end(JSON.stringify({ ok: false, error: "plugin non disponibile: " + prep.error }));
  }
  if (!guardRequest(req, res)) return;
  if (req.method === "GET" && (url.pathname === "/" || url.pathname === "/index.html")) maybePreloadWhisper();
  if (!isFullMode() && isOptionalApi(url.pathname)) {
    res.writeHead(403, { "Content-Type": "application/json", "Cache-Control": "no-store" });
    return res.end('{"ok":false,"err":"funzione non disponibile nella modalità essenziale"}');
  }
  if (handleApi(req, res, url, { port: PORT, fullMode: isFullMode(), requestId: reqId })) return;
  serveStatic(res, url.pathname);
  } catch (e) {
    logErr("http [" + reqId + "]: " + (e && e.stack || e));
    trace("http.error", { id: reqId, error: String(e && e.message || e) });
    if (!res.headersSent) {
      res.writeHead(500, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ ok: false, error: "errore interno" }));
    } else if (!res.writableEnded) {
      try { res.end(); } catch {}
    }
  }
});

let shuttingDown = false;
function shutdown() {
  if (shuttingDown) return;
  shuttingDown = true;
  try { instanceLock.release(); server.closeAllConnections?.(); server.close(() => process.exit(0)); } catch { process.exit(0); }
  setTimeout(() => process.exit(0), 1000).unref();
}
process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);

server.on("error", (e) => {
  if (e && e.code === "EADDRINUSE") {
    instanceLock.release();
    console.error("MathApp: porta " + PORT + " gia' in uso. Chiudi l'altra istanza o usa MATHAPP_PORT.");
    process.exit(1);
  }
  instanceLock.release();
  console.error("MathApp: errore server: " + (e && e.message || e));
});
process.on("uncaughtException", (e) => { try { logErr("uncaught: " + (e && e.stack || e)); } catch {} });
process.on("unhandledRejection", (e) => { try { logErr("unhandledRejection: " + (e && e.stack || e)); } catch {} });
process.on("exit", () => instanceLock.release());

server.listen(PORT, "127.0.0.1", () => {
  console.log(`MathApp su http://127.0.0.1:${PORT}`);
  try { getKey(); } catch (e) { console.warn("ATTENZIONE: " + e.message); }
  scheduleBackups();
});

