// Confine delle feature opzionali (modalita' "Completa").
export const OPTIONAL_PREFIXES = ["/api/quiz", "/api/flashcards", "/api/profile", "/api/kb", "/api/review"];

export function isOptionalApi(pathname) {
  return OPTIONAL_PREFIXES.some((p) => pathname === p || pathname.startsWith(p + "/"));
}
