// MathApp server - guscio HTTP: sicurezza, route API, statici e avvio.
import http from "node:http";
import { settings as SETTINGS, getKey } from "./lib/config.mjs";
import { guardRequest } from "./lib/security.mjs";
import { logErr } from "./lib/log.mjs";
import { scheduleBackups } from "./lib/storage.mjs";
import { maybePreloadWhisper } from "./lib/audio.mjs";
import { serveStatic } from "./lib/http.mjs";
import { handleApi } from "./routes/index.mjs";
import { isOptionalApi } from "./lib/features.mjs";

const PORT = Number(process.env.MATHAPP_PORT) || 8790;
const isFullMode = () => SETTINGS.mode === "full";

// ---------- http ----------
const server = http.createServer((req, res) => {
  const url = new URL(req.url, "http://127.0.0.1");
  if (!guardRequest(req, res)) return;
  if (req.method === "GET" && (url.pathname === "/" || url.pathname === "/index.html")) maybePreloadWhisper();
  if (!isFullMode() && isOptionalApi(url.pathname)) {
    res.writeHead(403, { "Content-Type": "application/json", "Cache-Control": "no-store" });
    return res.end('{"ok":false,"err":"funzione non disponibile nella modalità essenziale"}');
  }
    if (handleApi(req, res, url, { port: PORT })) return;
  serveStatic(res, url.pathname);
});

server.on("error", (e) => {
  if (e && e.code === "EADDRINUSE") {
    console.error("MathApp: porta " + PORT + " gia' in uso. Chiudi l'altra istanza o usa MATHAPP_PORT.");
    process.exit(1);
  }
  console.error("MathApp: errore server: " + (e && e.message || e));
});
process.on("uncaughtException", (e) => { try { logErr("uncaught: " + (e && e.stack || e)); } catch {} });
process.on("unhandledRejection", (e) => { try { logErr("unhandledRejection: " + (e && e.stack || e)); } catch {} });

server.listen(PORT, "127.0.0.1", () => {
  console.log(`MathApp su http://127.0.0.1:${PORT}`);
  try { getKey(); } catch (e) { console.warn("ATTENZIONE: " + e.message); }
  scheduleBackups();
});

