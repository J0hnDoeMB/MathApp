// Test unitario del parser dei quiz (lib/quizparse.mjs).
import assert from "node:assert/strict";
import { parseQuiz } from "./lib/quizparse.mjs";

// 1) JSON puro
let q = parseQuiz(JSON.stringify([
  { d: "Quanto fa 2+2?", opts: ["3", "4", "5", "6"], ok: 1, why: "aritmetica" },
]));
assert.equal(q.length, 1);
assert.equal(q[0].d, "Quanto fa 2+2?");
assert.equal(q[0].opts.length, 4);
assert.equal(q[0].ok, 1);
assert.equal(q[0].why, "aritmetica");

// 2) dentro un blocco ```json con testo attorno
q = parseQuiz("Ecco il quiz:\n```json\n[{\"d\":\"Derivata di x^2\",\"opts\":[\"x\",\"2x\",\"x^2\"],\"ok\":1}]\n```\nBuono studio!");
assert.equal(q.length, 1);
assert.equal(q[0].opts[1], "2x");
assert.equal(q[0].why, "");

// 3) opzione corretta indicata per testo ("risposta")
q = parseQuiz('[{"domanda":"Radice di 16","opzioni":["2","8","4","16"],"risposta":"4","spiegazione":"4^2=16"}]');
assert.equal(q.length, 1);
assert.equal(q[0].ok, 2);
assert.equal(q[0].why, "4^2=16");

// 4) domande malformate vengono scartate, quelle valide restano
q = parseQuiz(JSON.stringify([
  { d: "", opts: ["a", "b"], ok: 0 },
  { d: "ok", opts: ["a"], ok: 0 },              // una sola opzione → scartata
  { d: "ok2", opts: ["a", "b", "c"], ok: 5 },   // indice fuori range → scartata
  { d: "valida", opts: ["a", "b", "c", "d"], ok: 3, why: "perché sì" },
]));
assert.equal(q.length, 1);
assert.equal(q[0].d, "valida");
assert.equal(q[0].ok, 3);

// 5) niente JSON → array vuoto
assert.deepEqual(parseQuiz("nessun array qui, solo parole"), []);
assert.deepEqual(parseQuiz(""), []);

// 6) testo lungo troncato ai limiti
q = parseQuiz(JSON.stringify([{ d: "D".repeat(900), opts: ["a", "b"], ok: 0, why: "w".repeat(900) }]));
assert.equal(q[0].d.length, 400);
assert.equal(q[0].why.length, 600);

console.log("PASS: quizparse — JSON, blocco ```, risposta testuale, scarto dei malformati, limiti di lunghezza");
