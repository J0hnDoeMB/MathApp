import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const files = ["README.md", "CONTRIBUTING.md", "SECURITY.md", "CHANGELOG.md"];
const docs = path.join(root, "docs");
const walk = (dir) => fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => e.isDirectory() ? walk(path.join(dir, e.name)) : (e.name.endsWith(".md") ? [path.join(dir, e.name)] : []));
files.push(...walk(docs).map((p) => path.relative(root, p).replaceAll("\\", "/")));

const problems = [];
const seen = new Set();
for (const file of files) {
  if (!fs.existsSync(file)) continue;
  const text = fs.readFileSync(file, "utf8");
  if (/\bnode test_[a-z0-9_]+\.mjs\b/.test(text) || /python -m unittest test_sympy_cli\b/.test(text)) {
    problems.push(`${file}: stale root test path`);
  }
  for (const m of text.matchAll(/!?\[[^\]]*\]\(([^)\s]+)\)/g)) {
    let target = m[1];
    if (/^(https?:|mailto:|#)/i.test(target)) continue;
    target = target.split("#")[0].split("?")[0];
    if (!target) continue;
    try { target = decodeURIComponent(target); } catch { /* keep raw */ }
    const resolved = path.resolve(path.dirname(path.join(root, file)), target);
    if (!fs.existsSync(resolved)) problems.push(`${file}: missing ${m[1]}`);
    if (seen.has(file + "|" + resolved)) continue;
    seen.add(file + "|" + resolved);
  }
}
if (problems.length) {
  console.error(problems.join("\n"));
  process.exit(1);
}
console.log(`docs OK (${files.filter((f) => f.endsWith(".md")).length} files, ${seen.size} local links)`);
