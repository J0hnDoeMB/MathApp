// Guardie HTTP: header di sicurezza, CSRF e limite del body. Nessuna dipendenza dalle route.
import { MAX_BODY } from "./config.mjs";

// Le CDN sono fissate a versioni precise in public/index.html (SRI); qui diamo
// solo il permesso esplicito, senza aprire a origini arbitrarie.
const CSP = [
  "default-src 'self'",
  "script-src 'self' 'unsafe-inline' 'unsafe-eval' https://cdn.jsdelivr.net https://www.geogebra.org https://cdn.geogebra.org",
  "style-src 'self' 'unsafe-inline' https://cdn.jsdelivr.net https://fonts.googleapis.com https://www.geogebra.org",
  "font-src 'self' data: https://cdn.jsdelivr.net https://fonts.gstatic.com",
  "img-src 'self' data: blob: https://www.geogebra.org https://cdn.geogebra.org",
  "connect-src 'self' https://opencode.ai https://openrouter.ai https://www.geogebra.org https://cdn.geogebra.org https://cdn.jsdelivr.net https://fonts.googleapis.com https://fonts.gstatic.com",
  "frame-src 'self' https://www.geogebra.org https://cdn.geogebra.org",
  "worker-src 'self' blob:",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'none'",
].join("; ");

export function applySecurityHeaders(req, res) {
  try {
    res.setHeader("Content-Security-Policy", CSP);
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("X-Frame-Options", "DENY");
    res.setHeader("Referrer-Policy", "no-referrer");
    res.setHeader("Permissions-Policy", "camera=(), geolocation=(), microphone=(self)");
    res.setHeader("X-Permitted-Cross-Domain-Policies", "none");
    res.setHeader("X-DNS-Prefetch-Control", "off");
  } catch {}
}

export function guardRequest(req, res) {
  if (req.method !== "GET" && req.method !== "HEAD") {
    // Sec-Fetch-Site e' presente nei browser moderni; curl/script non lo mandano.
    const site = req.headers["sec-fetch-site"];
    if (site && site !== "same-origin" && site !== "none") {
      res.writeHead(403, { "Content-Type": "text/plain; charset=utf-8" });
      res.end("richiesta cross-site non consentita");
      return false;
    }
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
