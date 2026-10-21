// Small formatting helpers shared by the classic app script.
(function () {
  "use strict";
  const escapeHtml = (s) => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const fmtViewNum = (v) => (Number.isFinite(v) ? String(Math.round(v * 1e6) / 1e6) : "");
  const fmt6 = (v) => String(Number(Number(v).toFixed(6)));
  const fmtDate = (ms) => new Date(ms).toLocaleString("it-IT", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" });
  const fmtSize = (n) => n >= 1048576 ? (n / 1048576).toFixed(1) + " MB" : Math.max(1, Math.round(n / 1024)) + " KB";
  window.MathAppFormat = { escapeHtml, fmtViewNum, fmt6, fmtDate, fmtSize };
})();
