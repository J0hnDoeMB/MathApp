// Build a source release zip from the exact git tree (no data, secrets or node_modules).
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, "package.json"), "utf8"));
const version = String(pkg.version || "0.0.0");
const outDir = path.resolve(process.env.MATHAPP_RELEASE_DIR || path.join(ROOT, "release"));
const outFile = path.join(outDir, "mathapp-v" + version + ".zip");

function run(args) {
  const r = spawnSync("git", args, { cwd: ROOT, encoding: "utf8", windowsHide: true });
  if (r.error) throw r.error;
  if (r.status !== 0) throw new Error("git " + args.join(" ") + ": " + (r.stderr || r.stdout || "exit " + r.status));
  return (r.stdout || "").trim();
}

const dirty = run(["status", "--porcelain"]);
if (dirty) {
  console.error("release: worktree non pulito; fai commit prima di creare lo zip");
  process.exit(1);
}

const forbidden = run(["ls-files"]).split(/\r?\n/).filter((f) => /(^|\/)(settings\.json|data|backups|node_modules|\.env|mathapp\.log|logs)(\/|$)/.test(f));
if (forbidden.length) {
  console.error("release: file non distribuibili tracciati:\n" + forbidden.join("\n"));
  process.exit(1);
}

fs.mkdirSync(outDir, { recursive: true });
const prefix = "mathapp-v" + version + "/";
const r = spawnSync("git", ["archive", "--format=zip", "--prefix=" + prefix, "--output=" + outFile, "HEAD"], { cwd: ROOT, encoding: "utf8", windowsHide: true });
if (r.error) throw r.error;
if (r.status !== 0 || !fs.existsSync(outFile)) throw new Error("git archive fallito: " + (r.stderr || r.stdout || "exit " + r.status));
const size = fs.statSync(outFile).size;
if (size < 1024) throw new Error("release zip sospettosamente piccolo: " + size + " byte");
console.log("release: " + path.relative(ROOT, outFile) + " (" + Math.round(size / 1024) + " KB)");
