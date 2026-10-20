// Calcolo esatto.
import { runSympy } from "../lib/sympy.mjs";

export function handle(req, res, url) {
if (req.method === "POST" && url.pathname === "/api/compute") {
    let b = "";
    req.on("data", (c) => (b += c));
    req.on("end", async () => {
      let args = {};
      try { args = JSON.parse(b); } catch {}
      const out = await runSympy(args);
      res.writeHead(200, { "Content-Type": "application/json", "Cache-Control": "no-cache" });
      res.end(JSON.stringify(out));
    });
    return true;
  }
  

  return false;
}
