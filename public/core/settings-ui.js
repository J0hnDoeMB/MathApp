// Drawer impostazioni: provider, chiave, modello, lingua, livello, modalita',
// backup automatico e diagnostica. La logica di dominio resta nei moduli server.
(function () {
  "use strict";

  function create(deps) {
    const { appState, $, applyMode, loadDiagnostics, modelEl, inputEl, flash } = deps;
    let deferredInstall = null;
    let modelSeq = 0;

    async function fillModels(provider, selected) {
      const mdl = $("#setModel");
      if (!mdl) return;
      const seq = ++modelSeq;
      try {
        const r = await fetch("/api/models?provider=" + encodeURIComponent(provider));
        const mj = await r.json();
        if (seq !== modelSeq) return;
        const list = Array.isArray(mj.models) ? mj.models : [];
        mdl.innerHTML = list.map((m) => `<option value="${m}">${m}</option>`).join("");
        mdl.value = selected && list.includes(selected) ? selected : (mj.default || list[0] || "");
      } catch {}
    }

    async function loadSettings() {
      try {
        const r = await fetch("/api/settings");
        appState.ui.settingsData = await r.json();
      } catch {
        appState.ui.settingsData = null;
      }
      const d = appState.ui.settingsData;
      if (!d || !d.ok) return;
      applyMode(d.mode || "core");
      const modeSel = $("#setMode");
      if (modeSel) modeSel.value = d.mode || "core";
      const levelSel = $("#setLevel");
      if (levelSel) levelSel.value = d.level || "auto";
      if ((d.mode || "core") === "full" && window.MathAppPlugins) {
        for (const id of ["quiz", "review", "tts", "kb", "style"]) {
          window.MathAppPlugins.load(id).catch((e) => console.warn("[MathApp] " + id + " plugin", e));
        }
      }
      const banner = $("#setupBanner");
      if (banner) banner.hidden = !!d.hasKey;
      const prov = $("#setProvider");
      if (prov) prov.value = d.provider || "openrouter";
      const keyEl = $("#setKey");
      if (keyEl) keyEl.value = "";
      const ks = $("#setKeyState");
      if (ks) {
        ks.textContent = d.hasKey
          ? (d.keySource === "settings" ? ("chiave salvata (..." + d.keyHint + ")") : "chiave esistente (auth OpenCode locale)")
          : "nessuna chiave configurata";
      }
      const clear = $("#settingsClearKey");
      if (clear) clear.hidden = !(d.hasKey && d.keySource === "settings");
      const testMsg = $("#settingsTestMsg");
      if (testMsg) testMsg.textContent = "";
      const lang = $("#setLang");
      if (lang) lang.value = d.whisperLanguage || "it";
      const backup = $("#setBackup");
      if (backup) backup.checked = d.backup !== false;
      const hours = $("#setBackupHours");
      if (hours) hours.value = Number(d.backupHours) || 24;
      await fillModels(d.provider || "openrouter", d.model);
      loadDiagnostics();
    }

    async function testConnection() {
      const btn = $("#settingsTest");
      const msg = $("#settingsTestMsg");
      if (!btn || !msg) return false;
      btn.disabled = true;
      msg.textContent = "verifico la connessione...";
      const body = {
        provider: $("#setProvider") ? $("#setProvider").value : "openrouter",
        model: $("#setModel") ? $("#setModel").value : "",
      };
      const typedKey = $("#setKey") ? $("#setKey").value.trim() : "";
      if (typedKey) body.apiKey = typedKey;
      try {
        const r = await fetch("/api/settings/test", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        });
        const j = await r.json().catch(() => ({}));
        if (r.ok && j.ok) {
          msg.textContent = "Connessione OK \u00b7 " + j.provider + " \u00b7 " + j.model + " \u00b7 " + j.latencyMs + " ms" + (j.reply ? " \u00b7 " + j.reply : "");
          return true;
        }
        msg.textContent = "Errore: " + (j.error || "test fallito");
        return false;
      } catch {
        msg.textContent = "Errore di rete";
        return false;
      } finally {
        btn.disabled = false;
      }
    }

    function updateInstallUI() {
      const btn = $("#installApp");
      const hint = $("#installHint");
      if (!btn || !hint) return;
      const standalone = (window.matchMedia && window.matchMedia("(display-mode: standalone)").matches) || window.navigator.standalone === true;
      if (standalone) {
        btn.hidden = true;
        hint.textContent = "MathApp \u00e8 installata su questo dispositivo.";
        return;
      }
      if (deferredInstall) {
        btn.hidden = false;
        hint.textContent = "Installa MathApp come app, senza la barra del browser.";
        return;
      }
      btn.hidden = true;
      hint.textContent = "Dal menu del browser scegli \u201cInstalla app\u201d. Su iPhone usa Condividi \u2192 Aggiungi alla schermata Home.";
    }

    async function promptInstall() {
      if (!deferredInstall) return false;
      const prompt = deferredInstall;
      deferredInstall = null;
      try {
        await prompt.prompt();
        const choice = await prompt.userChoice;
        if (choice && choice.outcome === "accepted") flash("MathApp installata");
      } catch {}
      updateInstallUI();
      return true;
    }

    async function saveSettings(extra) {
      const msg = $("#settingsMsg");
      const body = Object.assign({
        provider: $("#setProvider").value,
        whisperLanguage: $("#setLang").value,
      }, extra || {});
      const mv = $("#setModel").value;
      if (mv) body.model = mv;
      const modeEl = $("#setMode");
      if (modeEl) body.mode = modeEl.value;
      const levelEl = $("#setLevel");
      if (levelEl) body.level = levelEl.value;
      const backupEl = $("#setBackup");
      if (backupEl) body.backup = backupEl.checked;
      const hoursEl = $("#setBackupHours");
      if (hoursEl) body.backupHours = Number(hoursEl.value);
      const k = $("#setKey").value.trim();
      if (k) body.apiKey = k;
      try {
        const r = await fetch("/api/settings", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        });
        const j = await r.json();
        if (!j.ok) {
          if (msg) msg.textContent = "Errore: " + (j.err || "salvataggio fallito");
          return;
        }
        if (msg) msg.textContent = "Salvato.";
        if (j.model) {
          appState.domain.currentModel = j.model;
          if (modelEl) modelEl.value = j.model;
        }
        if (j.mode) {
          applyMode(j.mode);
          const ms = $("#setMode");
          if (ms) ms.value = j.mode;
        }
        if (j.level) {
          const ls = $("#setLevel");
          if (ls) ls.value = j.level;
        }
        await loadSettings();
        try {
          const provider = j.provider || ($("#setProvider") ? $("#setProvider").value : "openrouter");
          const mr = await fetch("/api/models?provider=" + encodeURIComponent(provider));
          const mj = await mr.json();
          const vis = mj.vision || {};
          modelEl.innerHTML = mj.models.map((m) => `<option value="${m}">${m}${vis[m] === false ? " (solo testo)" : ""}</option>`).join("");
          appState.domain.currentModel = j.model || mj.default || appState.domain.currentModel;
          modelEl.value = appState.domain.currentModel;
        } catch {}
      } catch {
        if (msg) msg.textContent = "Errore di rete";
      }
    }

    function init() {
      const drawer = $("#settingsDrawer");
      if (!drawer) return;
      const chatWelcome = $("#chatWelcome");
      if (chatWelcome) {
        chatWelcome.addEventListener("click", (e) => {
          const q = e.target.closest("[data-q]");
          if (!q) return;
          inputEl.value = q.dataset.q;
          inputEl.focus();
        });
      }
      MathAppState.handle("settings.open", async () => {
        const el = $("#settingsDrawer");
        if (!el) return false;
        el.hidden = false;
        await loadSettings();
        return true;
      });
      MathAppState.handle("settings.toggle", async () => {
        const el = $("#settingsDrawer");
        if (!el) return false;
        el.hidden = !el.hidden;
        if (!el.hidden) await loadSettings();
        return !el.hidden;
      });
      MathAppState.handle("settings.test", () => testConnection());
      MathAppState.handle("settings.save", (payload) => saveSettings(payload || {}));
      MathAppState.handle("settings.clearKey", () => saveSettings({ clearKey: true }));

      const providerEl = $("#setProvider");
      if (providerEl) providerEl.addEventListener("change", () => {
        const msg = $("#settingsTestMsg");
        if (msg) msg.textContent = "";
        const keyEl = $("#setKey");
        if (keyEl) keyEl.value = "";
        const ks = $("#setKeyState");
        if (ks) ks.textContent = "premi Test per verificare la chiave del provider selezionato";
        fillModels(providerEl.value, "");
      });
      const settingsBtn = $("#settingsBtn");
      if (settingsBtn) settingsBtn.addEventListener("click", () => {
        MathAppState.dispatch("settings.toggle").catch((e) => console.warn("[MathApp] settings.toggle", e));
      });
      const closeBtn = $("#settingsClose");
      if (closeBtn) closeBtn.addEventListener("click", () => {
        MathAppState.dispatch("settings.close").catch((err) => console.warn("[MathApp] settings.close", err));
      });
      const openBtn = $("#setupOpen");
      if (openBtn) openBtn.addEventListener("click", () => {
        MathAppState.dispatch("settings.open").catch((e) => console.warn("[MathApp] settings.open", e));
      });
      const saveBtn = $("#settingsSave");
      if (saveBtn) saveBtn.addEventListener("click", () => {
        MathAppState.dispatch("settings.save").catch((e) => console.warn("[MathApp] settings.save", e));
      });
      const clearKeyBtn = $("#settingsClearKey");
      if (clearKeyBtn) clearKeyBtn.addEventListener("click", () => {
        MathAppState.dispatch("settings.clearKey").catch((e) => console.warn("[MathApp] settings.clearKey", e));
      });
      const testBtn = $("#settingsTest");
      if (testBtn) testBtn.addEventListener("click", () => {
        MathAppState.dispatch("settings.test").catch((e) => console.warn("[MathApp] settings.test", e));
      });
      const diagBtn = $("#diagRefresh");
      if (diagBtn) diagBtn.addEventListener("click", () => {
        MathAppState.dispatch("diagnostics.refresh").catch((err) => console.warn("[MathApp] diagnostics.refresh", err));
      });
      const installBtn = $("#installApp");
      if (installBtn) installBtn.addEventListener("click", () => { promptInstall(); });
      window.addEventListener("beforeinstallprompt", (event) => {
        event.preventDefault();
        deferredInstall = event;
        updateInstallUI();
      });
      window.addEventListener("appinstalled", () => {
        deferredInstall = null;
        updateInstallUI();
      });
      if (window.matchMedia) {
        const mq = window.matchMedia("(display-mode: standalone)");
        if (mq.addEventListener) mq.addEventListener("change", updateInstallUI);
      }
      updateInstallUI();
    }

    return { init, loadSettings, saveSettings };
  }

  window.MathAppSettingsUI = { create };
})();
