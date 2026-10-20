// Route di sessione, cronologia e stato GeoGebra.
import { readSession, applyState, history, deleteSession, updateTags } from "../lib/session-store.mjs";

function sendJson(res, status, value) {
  res.writeHead(status, { "Content-Type": "application/json", "Cache-Control": "no-cache" });
  res.end(JSON.stringify(value));
}

export function handle(req, res, url) {
  if (req.method === "POST" && url.pathname === "/api/conversation/state") {
    let b = "";
    req.on("data", (c) => (b += c));
    req.on("end", () => {
      let raw;
      try { raw = JSON.parse(b); } catch { return sendJson(res, 400, { error: "richiesta non valida" }); }
      const result = applyState(raw);
      sendJson(res, result.status || 200, result.status ? { ok: false, error: result.error } : result);
    });
    return true;
  }

  if (req.method === "GET" && url.pathname === "/api/history") {
    sendJson(res, 200, { items: history(url.searchParams.get("q") || "") });
    return true;
  }

  if (req.method === "GET" && url.pathname === "/api/conversation") {
    const c = readSession(url.searchParams.get("id") || "");
    if (!c) { sendJson(res, 404, { error: "not found" }); return true; }
    sendJson(res, 200, c);
    return true;
  }

  if (req.method === "DELETE" && url.pathname === "/api/conversation") {
    deleteSession(url.searchParams.get("id") || "");
    sendJson(res, 200, { ok: true });
    return true;
  }

  if (req.method === "POST" && url.pathname === "/api/conversation/tags") {
    let b = "";
    req.on("data", (c) => (b += c));
    req.on("end", () => {
      try {
        const { id, tag, action } = JSON.parse(b);
        const result = updateTags(id, tag, action);
        sendJson(res, result.status || 200, result.status === 200 || result.status === undefined ? { ok: result.ok, tags: result.tags, error: result.error } : { error: result.error });
      } catch {
        sendJson(res, 400, { error: "richiesta non valida" });
      }
    });
    return true;
  }

  return false;
}
