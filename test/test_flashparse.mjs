// Test del parser delle flashcard generate dall'IA (lib/flashparse.mjs).
import assert from "node:assert/strict";
import { parseCards } from "../lib/flashparse.mjs";

// 1) JSON puro
assert.deepEqual(parseCards('[{"d":"Quanto fa 2+2?","r":"4"}]'), [{ d: "Quanto fa 2+2?", r: "4" }]);

// 2) dentro un blocco ```json con testo attorno
const fenced = 'Ecco le flashcard:\n```json\n[{"d":"Radice di 9","r":"3"},{"d":"Derivata di x^2","r":"2x"}]\n```\nSpero vadano bene.';
assert.equal(parseCards(fenced).length, 2);

// 3) chiavi alternative (domanda/risposta, front/back)
assert.equal(parseCards('[{"domanda":"Q1","risposta":"R1"}]')[0].r, "R1");
assert.equal(parseCards('[{"front":"Q2","back":"R2"}]')[0].d, "Q2");

// 4) JSON sporco: array perso in prosa
const sporco = 'Certamente! [{"d":"A","r":"1"},{"d":"B","r":"2"}] Buono studio.';
assert.equal(parseCards(sporco).length, 2);

// 5) spazzatura -> vuoto
assert.equal(parseCards("non ho capito la richiesta").length, 0);

// 6) fallback righe "domanda | risposta"
assert.deepEqual(parseCards("- Capitale d'Italia? | Roma\n2) 5*3? | 15"), [{ d: "Capitale d'Italia?", r: "Roma" }, { d: "5*3?", r: "15" }]);

// 7) scarta voci incomplete
assert.equal(parseCards('[{"d":"solo domanda"}]').length, 0);

// 8) tronca risposte giganti
assert.equal(parseCards('[{"d":"Q","r":"' + "x".repeat(5000) + '"}]')[0].r.length, 1200);

console.log("PASS: flashparse — JSON, fence, chiavi alternative, fallback, scarto");
