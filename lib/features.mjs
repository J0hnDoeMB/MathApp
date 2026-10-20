// Confine delle feature opzionali e registro dei plugin di route.
export const OPTIONAL_FEATURES = [
  { id: "kb", prefixes: ["/api/kb"], module: "kb" },
  { id: "profile", prefixes: ["/api/profile"], module: "profile" },
  { id: "review", prefixes: ["/api/review"], module: "review" },
  { id: "study", prefixes: ["/api/quiz", "/api/flashcards"], module: "study" },
];

export function featureForPath(pathname) {
  for (const feature of OPTIONAL_FEATURES) {
    if (feature.prefixes.some((p) => pathname === p || pathname.startsWith(p + "/"))) return feature;
  }
  return null;
}

export function isOptionalApi(pathname) {
  return !!featureForPath(pathname);
}
