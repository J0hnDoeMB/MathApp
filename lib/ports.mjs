// Contratti delle porte verso i sistemi esterni.
export const PORT_METHODS = {
  llm: ["stream", "generate", "vision"],
  math: ["compute"],
  graph: ["run", "edit", "resolve"],
  audio: ["transcribe"],
  documents: ["extractText"],
};

export function assertPorts(container) {
  for (const [port, methods] of Object.entries(PORT_METHODS)) {
    const impl = container && container[port];
    if (!impl || typeof impl !== "object") throw new Error("porta mancante: " + port);
    for (const method of methods) {
      if (typeof impl[method] !== "function") throw new Error("metodo mancante: " + port + "." + method);
    }
  }
  return true;
}
