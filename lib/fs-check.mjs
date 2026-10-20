// Verifica di scrivibilità senza dipendenze dal dominio.
import fs from "node:fs";
import path from "node:path";

export function dirWritable(dir) {
  try {
    fs.mkdirSync(dir, { recursive: true });
    const probe = path.join(dir, ".write-probe-" + process.pid);
    fs.writeFileSync(probe, "ok");
    fs.rmSync(probe, { force: true });
    return { ok: true };
  } catch (e) {
    return { ok: false, error: String(e.message || e) };
  }
}
