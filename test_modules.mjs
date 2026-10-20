// Test dei moduli di dominio senza avviare il server.
import assert from "node:assert/strict";
import { LEVELS, normalizeLevel, levelRule } from "./lib/levels.mjs";
import { tokenize, chunkText } from "./lib/kb.mjs";
import { revNorm } from "./lib/storage.mjs";
import { cachePut } from "./lib/util.mjs";
import { isAudio } from "./lib/audio.mjs";
import { TOOLS, toolsFor } from "./lib/tools.mjs";
import { systemFor } from "./lib/prompts.mjs";

let ok = 0, fail = 0;
function chk(name, fn) {
  try { fn(); console.log("OK   " + name); ok++; }
  catch (e) { console.error("FAIL " + name + ": " + e.message); fail++; }
}

chk("levels: valori e alias", () => {
  assert.deepEqual(LEVELS, ["auto", "breve", "dettagliato", "approfondito"]);
  assert.equal(normalizeLevel("base"), "breve");
  assert.equal(normalizeLevel("superiore"), "dettagliato");
  assert.equal(normalizeLevel("universita"), "approfondito");
  assert.equal(normalizeLevel("sconosciuto"), null);
  assert.match(levelRule("breve"), /LIVELLO \(breve\)/);
});

chk("prompts: livello e modalita didattica", () => {
  const s = systemFor("socratic", true, "breve");
  assert.match(s, /LIVELLO \(breve\)/);
  assert.match(s, /ESERCITAMI/);
  assert.match(s, /SFONDO SCURO/);
});

chk("tools: core senza delega/ricorda, full completo", () => {
  const core = toolsFor(false).map((t) => t.function.name);
  assert.equal(core.includes("delega"), false);
  assert.equal(core.includes("ricorda"), false);
  assert.equal(core.includes("sympy_compute"), true);
  assert.equal(toolsFor(true).length, TOOLS.length);
  assert.equal(new Set(TOOLS.map((t) => t.function.name)).size, TOOLS.length);
});

chk("kb: tokenize rimuove stopword e normalizza", () => {
  const t = tokenize("come calcolare il limite di una funzione");
  assert.equal(t.includes("come"), false);
  assert.equal(t.includes("una"), false);
  assert.equal(t.includes("limite"), false);
  assert.equal(t.includes("limit"), true);
});

chk("kb: chunkText conserva la pagina", () => {
  const c = chunkText("--- pagina 7 ---\nprima parte\n\nseconda parte");
  assert.equal(c.length, 1);
  assert.equal(c[0].page, 7);
  assert.match(c[0].text, /prima parte/);
});

chk("storage: revNorm completa lo schema SM-2", () => {
  const r = revNorm({ t: 123 });
  assert.equal(r.due, 123);
  assert.equal(r.reps, 0);
  assert.equal(r.ease, 2.5);
  assert.equal(r.interval, 0);
  assert.equal(r.lapses, 0);
});

chk("util: cachePut rispetta il tetto", () => {
  const m = new Map();
  cachePut(m, "a", 1, 2); cachePut(m, "b", 2, 2); cachePut(m, "c", 3, 2);
  assert.equal(m.size, 1);
  assert.equal(m.get("c"), 3);
});

chk("audio: riconosce le estensioni", () => {
  assert.equal(isAudio("lezione.m4a", ""), true);
  assert.equal(isAudio("x.pdf", "application/pdf"), false);
  assert.equal(isAudio("x", "audio/webm"), true);
});

chk("tools: schema con parametri minimi", () => {
  const sympy = TOOLS.find((t) => t.function.name === "sympy_compute");
  assert.equal(sympy.function.parameters.required.includes("operation"), true);
  const ggb = TOOLS.find((t) => t.function.name === "geogebra");
  assert.equal(ggb.function.parameters.required.includes("commands"), true);
});

chk("levels: auto e approfondito", () => {
  assert.match(levelRule("auto"), /LIVELLO \(auto\)/);
  assert.match(levelRule("approfondito"), /controesempi/);
});

console.log("----");
console.log("OK=" + ok + " FAIL=" + fail);
if (fail) process.exit(1);
