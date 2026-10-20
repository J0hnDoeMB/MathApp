// Schema e migrazioni dei dati persistiti.
// Regola: i dati vecchi vengono migrati in lettura, mai rifiutati in blocco.
export const SCHEMA_VERSION = 1;
export const MAX_GGB_CHARS = 8 * 1024 * 1024;
export const MAX_CELLS = 200;
export const MAX_FIGURES = 60;
export const MAX_TAGS = 8;

const has = (o, k) => Object.prototype.hasOwnProperty.call(o, k);
const str = (v, max) => String(v == null ? "" : v).slice(0, max);
const num = (v) => (Number.isFinite(Number(v)) ? Math.max(-1e6, Math.min(1e6, Number(v))) : null);

export function migrateSession(input) {
  const s = input && typeof input === "object" && !Array.isArray(input) ? { ...input } : {};
  s.schemaVersion = Number.isSafeInteger(s.schemaVersion) ? s.schemaVersion : SCHEMA_VERSION;
  s.messages = Array.isArray(s.messages) ? s.messages.filter((m) => m && (m.role === "user" || m.role === "assistant")) : [];
  s.cells = Array.isArray(s.cells) ? s.cells.filter((c) => c && typeof c === "object").slice(-MAX_CELLS) : [];
  s.figures = Array.isArray(s.figures) ? s.figures.filter((f) => f && typeof f === "object").slice(-MAX_FIGURES) : [];
  s.figsIssued = Array.isArray(s.figsIssued) ? s.figsIssued.filter((f) => typeof f === "string").slice(-200) : [];
  s.tags = Array.isArray(s.tags) ? s.tags.filter((t) => typeof t === "string" && t.trim()).slice(0, MAX_TAGS) : [];
  s.createdAt = Number.isFinite(s.createdAt) ? s.createdAt : Date.now();
  s.updatedAt = Number.isFinite(s.updatedAt) ? s.updatedAt : s.createdAt;
  s.stateRevision = Number.isSafeInteger(s.stateRevision) && s.stateRevision >= 0 ? s.stateRevision : 0;
  s.title = str(s.title, 90) || "Nuova chat";
  return s;
}

// Valida e normalizza il payload di /api/conversation/state.
// Non applica ancora le regole di merge (revisione, figure emesse): quelle
// restano nel SessionStore, che conosce lo stato precedente.
export function validateState(raw) {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return { ok: false, error: "stato non valido" };
  const id = str(raw.id, 200).trim();
  if (!id) return { ok: false, error: "id mancante" };
  let revision = null;
  if (has(raw, "revision")) {
    if (!Number.isSafeInteger(raw.revision) || raw.revision < 0) return { ok: false, error: "revisione non valida" };
    revision = raw.revision;
  }
  let ggb;
  if (has(raw, "ggb")) {
    if (raw.ggb === null || raw.ggb === "") ggb = null;
    else if (typeof raw.ggb !== "string") return { ok: false, error: "stato GeoGebra non valido" };
    else if (raw.ggb.length > MAX_GGB_CHARS) return { ok: false, error: "stato GeoGebra troppo grande" };
    else ggb = raw.ggb;
  }
  let cells;
  if (has(raw, "cells")) {
    if (!Array.isArray(raw.cells)) return { ok: false, error: "celle non valide" };
    if (JSON.stringify(raw.cells).length > 2 * 1024 * 1024) return { ok: false, error: "quaderno troppo grande" };
    cells = raw.cells.filter((c) => c && typeof c === "object" && !Array.isArray(c)).slice(-MAX_CELLS);
  }
  let figures;
  if (has(raw, "figures")) {
    if (!Array.isArray(raw.figures)) return { ok: false, error: "figure non valide" };
    figures = raw.figures.filter((f) => f && typeof f === "object" && !Array.isArray(f)).slice(-MAX_FIGURES);
  }
  const mode = has(raw, "mode") ? str(raw.mode, 20) : undefined;
  const view3d = has(raw, "view3d") ? raw.view3d === true : undefined;
  let view;
  let hasView = has(raw, "view");
  if (hasView) {
    if (raw.view === null) view = null;
    else if (raw.view && typeof raw.view === "object") {
      const xmin = num(raw.view.xmin), xmax = num(raw.view.xmax);
      const ymin = num(raw.view.ymin), ymax = num(raw.view.ymax);
      if (xmin !== null && xmax !== null && ymin !== null && ymax !== null && xmin < xmax && ymin < ymax) {
        view = { xmin, xmax, ymin, ymax, axes: raw.view.axes !== false, grid: raw.view.grid === true };
      } else {
        hasView = false;
      }
    } else {
      hasView = false;
    }
  }
  return {
    ok: true,
    state: { id, revision, ggb, hasGgb: has(raw, "ggb"), cells, figures, mode, view3d, view, hasView },
  };
}

export function cleanTag(tag) {
  return str(tag, 24).trim().replace(/\s+/g, " ").replace(/^#+/, "");
}
