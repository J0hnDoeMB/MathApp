// Ponte verso l'applet GeoGebra: comandi, modifiche e conferme dal browser.
import crypto from "node:crypto";
import { readSession, writeSession } from "./session-store.mjs";
import { logErr } from "./log.mjs";

const ggbPending = new Map(); // callId -> resolve

export function resolveGGB(callId, results) {
  const r = ggbPending.get(callId);
  if (r) r(results);
}

export function runGGB(send, commands, title, mode, convId, view, signal) {
  if (signal && signal.aborted) return Promise.resolve({ error: "richiesta annullata" });
  const callId = crypto.randomUUID();
  const fid = crypto.randomUUID(); // il server EMETTE la costruzione: solo queste verranno accettate
  const md = mode === "add" ? "add" : "replace";
  const vw = view === "3d" ? "3d" : "2d";
  send("geogebra", { callId, fid, commands, title: title || "", mode: md, view: vw });
  if (convId) {
    try {
      let c = readSession(convId);
      if (!c) c = { id: convId, title: "Nuova chat", createdAt: Date.now(), messages: [], figures: [], cells: [], ggb: null };
      c.figsIssued = Array.isArray(c.figsIssued) ? c.figsIssued : [];
      if (!c.figsIssued.includes(fid)) c.figsIssued.push(fid);
      c.figsIssued = c.figsIssued.slice(-200);
      writeSession(c, false);
    } catch (e) { logErr("figsIssued: " + e.message); }
  }
  return new Promise((resolve) => {
    let t = null;
    const cleanup = () => {
      if (t) clearTimeout(t);
      ggbPending.delete(callId);
      if (signal) signal.removeEventListener("abort", onAbort);
    };
    const finish = (value) => { cleanup(); resolve(value); };
    const onAbort = () => finish({ error: "richiesta annullata" });
    ggbPending.set(callId, finish);
    t = setTimeout(() => finish({ note: "nessuna conferma dal browser (timeout 12s)" }), 12000);
    if (signal) {
      signal.addEventListener("abort", onAbort, { once: true });
      if (signal.aborted) onAbort();
    }
  });
}

export function runGGBEdit(send, ops, signal) {
  if (signal && signal.aborted) return Promise.resolve({ error: "richiesta annullata" });
  const callId = crypto.randomUUID();
  send("geogebra_edit", { callId, ops });
  return new Promise((resolve) => {
    let t = null;
    const cleanup = () => {
      if (t) clearTimeout(t);
      ggbPending.delete(callId);
      if (signal) signal.removeEventListener("abort", onAbort);
    };
    const finish = (value) => { cleanup(); resolve(value); };
    const onAbort = () => finish({ error: "richiesta annullata" });
    ggbPending.set(callId, finish);
    t = setTimeout(() => finish({ note: "nessuna conferma dal browser (timeout 10s)" }), 10000);
    if (signal) {
      signal.addEventListener("abort", onAbort, { once: true });
      if (signal.aborted) onAbort();
    }
  });
}
