// Backup manuale di data/.
import fs from "node:fs";
import path from "node:path";
import { BACKUP_DIR, runBackup } from "../lib/storage.mjs";

export function handle(req, res, url) {
if (url.pathname === "/api/backup") {
    if (req.method === "GET") {
      let items = [];
      try {
        items = fs.readdirSync(BACKUP_DIR).filter((f) => f.endsWith(".zip")).map((f) => {
          const st = fs.statSync(path.join(BACKUP_DIR, f));
          return { file: f, size: st.size, t: st.mtimeMs };
        }).sort((a, b) => b.t - a.t);
      } catch {}
      res.writeHead(200, { "Content-Type": "application/json", "Cache-Control": "no-cache" });
      return res.end(JSON.stringify({ items }));
    }
    if (req.method === "POST") {
      const r = runBackup();
      res.writeHead(r.ok ? 200 : 500, { "Content-Type": "application/json" });
      return res.end(JSON.stringify(r));
    }
  }
  

  return false;
}
