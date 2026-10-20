// Stato client: domain e UI separati, con eventi e accessori di compatibilita'.
// app.js e' ancora un classico script: gli accessori permettono di migrare i
// punti di lettura/scrittura senza un big-bang. I nuovi codice deve usare
// MathAppState.domain / MathAppState.ui.
(function () {
  const storedConv = (() => { try { return localStorage.getItem("mathapp.conv"); } catch { return null; } })();
  const revision = (() => { try { return Number(localStorage.getItem("mathapp.stateRevision")) || 0; } catch { return 0; } })();
  const conversationId = storedConv || crypto.randomUUID();

  const domain = {
    messages: [],
    conversationId,
    sessionId: conversationId,
    conversationGeneration: 0,
    stateRevision: revision,
    cellData: [],
    mode: "figure",
    tutorMode: null,
    stepMode: false,
    currentModel: "deepseek-v4.1-flash",
    figures: [],
    figSeq: 0,
    ggb3d: false,
    viewCustom: null,
    viewCache: null,
  };
  const ui = {
    booting: true,
    conversationLoading: false,
    currentAbort: null,
    pendingSources: null,
    usageTot: { prompt: 0, completion: 0, total: 0 },
    streaming: false,
    autoFollow: true,
    pending: [],
    settingsData: null,
  };

  const listeners = new Map();
  function on(event, fn) {
    if (!listeners.has(event)) listeners.set(event, new Set());
    listeners.get(event).add(fn);
    return () => listeners.get(event) && listeners.get(event).delete(fn);
  }
  function emit(event, value) {
    for (const fn of listeners.get(event) || []) {
      try { fn(value, event); } catch (e) { console.warn("[MathAppState]", e); }
    }
  }
  function bind(target, group, names) {
    for (const name of names) {
      Object.defineProperty(window, name, {
        configurable: true,
        enumerable: false,
        get: () => target[name],
        set: (value) => { target[name] = value; emit(group + ":" + name, value); },
      });
    }
  }
  bind(domain, "domain", Object.keys(domain));
  bind(ui, "ui", Object.keys(ui));

  window.MathAppState = {
    domain,
    ui,
    on,
    emit,
    snapshot: () => ({ domain: { ...domain }, ui: { ...ui } }),
  };
})();
