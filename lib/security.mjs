// Guardie HTTP: CSRF e limite del body. Nessuna dipendenza dalle route.
import { MAX_BODY } from "./config.mjs";

export function guardRequest(req, res) {
  if (req.method !== "GET" && req.method !== "HEAD") {
    const origin = req.headers.origin;
    if (origin) {
      let okOrigin = false;
      try { okOrigin = new URL(origin).host === req.headers.host; } catch {}
      if (!okOrigin) {
        res.writeHead(403, { "Content-Type": "text/plain; charset=utf-8" });
        res.end("origine non consentita");
        return false;
      }
    }
    const cl = Number(req.headers["content-length"] || 0);
    if (cl > MAX_BODY) {
      res.writeHead(413, { "Content-Type": "text/plain; charset=utf-8" });
      res.end("richiesta troppo grande");
      return false;
    }
    let seen = 0, tooBig = false;
    req.on("data", (c) => {
      if (tooBig) return;
      seen += c.length;
      if (seen > MAX_BODY) {
        tooBig = true;
        try { res.writeHead(413, { "Content-Type": "text/plain; charset=utf-8" }); res.end("richiesta troppo grande"); } catch {}
        try { req.destroy(); } catch {}
      }
    });
  }
  return true;
}
