import fs from "node:fs";

let version = "0.0.0";
try {
  version = JSON.parse(fs.readFileSync(new URL("../package.json", import.meta.url), "utf8")).version || version;
} catch {}

export const APP_VERSION = version;
