// Loader delle feature UI opzionali. I plugin sono classici script che si
// registrano con MathAppPlugins.register(id, init) e ricevono MathAppApp.
(function () {
  const registry = new Map();
  const loaded = new Set();
  const loading = new Map();

  function register(id, init) {
    registry.set(id, init);
  }

  function load(id) {
    if (loaded.has(id)) return Promise.resolve(window.MathAppApp);
    if (loading.has(id)) return loading.get(id);
    const task = new Promise((resolve, reject) => {
      const s = document.createElement("script");
      s.src = "/features/" + id + ".js";
      s.async = true;
      s.onload = () => {
        const init = registry.get(id);
        if (typeof init !== "function") return reject(new Error("plugin UI senza init: " + id));
        try {
          init(window.MathAppApp);
          loaded.add(id);
          resolve(window.MathAppApp);
        } catch (e) { reject(e); }
      };
      s.onerror = () => reject(new Error("plugin UI non caricato: " + id));
      document.head.appendChild(s);
    });
    loading.set(id, task);
    return task.finally(() => loading.delete(id));
  }

  window.MathAppPlugins = {
    register,
    load,
    has: (id) => loaded.has(id),
    loaded: () => [...loaded],
  };
})();
