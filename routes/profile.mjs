// Memoria di stile.
import { profLoad, profSave, profAdd } from "../lib/profile.mjs";

export const feature = "profile";

export function handle(req, res, url) {
if (url.pathname === "/api/profile") {
    if (req.method === "GET") {
      res.writeHead(200, { "Content-Type": "application/json", "Cache-Control": "no-cache" });
      return res.end(JSON.stringify({ items: profLoad() }));
    }
    if (req.method === "POST") {
      let b = "";
      req.on("data", (c) => (b += c));
      req.on("end", () => {
        try {
          const c = profAdd(JSON.parse(b).testo, "manuale");
          res.writeHead(c ? 200 : 400, { "Content-Type": "application/json" });
          res.end(c ? JSON.stringify({ ok: true, item: c }) : '{"error":"preferenza troppo corta"}');
        } catch { res.writeHead(400); res.end('{"error":"bad"}'); }
      });
      return;
    }
    if (req.method === "DELETE") {
      const id = url.searchParams.get("id") || "";
      profSave(profLoad().filter((c) => c.id !== id));
      res.writeHead(200, { "Content-Type": "application/json" }); return res.end('{"ok":true}');
    }
  }
  
  return false;
}
