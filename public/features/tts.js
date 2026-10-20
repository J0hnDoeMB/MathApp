// Plugin UI opzionale: lettura ad alta voce (voce del browser).
(function () {
  MathAppPlugins.register("tts", function init(app) {
    const flash = app.flash;
    let ttsBtn = null;

    function clean(t) {
      return String(t || "")
        .replace(/```[\s\S]*?```/g, " (blocco di codice) ")
        .replace(/\$\$[\s\S]*?\$\$/g, " formula ")
        .replace(/\$[^$\n]*\$/g, " formula ")
        .replace(/^#{1,6}\s*/gm, "")
        .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
        .replace(/[*_`>#]/g, "")
        .replace(/\s{2,}/g, " ")
        .trim();
    }

    function stop() {
      try { if ("speechSynthesis" in window) speechSynthesis.cancel(); } catch {}
      if (ttsBtn) { ttsBtn.textContent = "Ascolta"; ttsBtn = null; }
    }

    function speak(text, btn) {
      if (!("speechSynthesis" in window)) { flash("il browser non supporta la lettura ad alta voce"); return; }
      if (ttsBtn === btn) { stop(); return; }
      stop();
      const testo = clean(text).slice(0, 12000);
      if (!testo) return;
      try {
        const u = new SpeechSynthesisUtterance(testo);
        u.lang = "it-IT";
        const voices = speechSynthesis.getVoices() || [];
        const it = voices.find((v) => /^it/i.test(v.lang || ""));
        if (it) { try { u.voice = it; } catch {} }
        u.onend = () => { if (ttsBtn === btn) { btn.textContent = "Ascolta"; ttsBtn = null; } };
        speechSynthesis.speak(u);
        btn.textContent = "Ferma";
        ttsBtn = btn;
      } catch { flash("lettura non disponibile"); }
    }

    window.ttsSpeak = speak;
    return { speak, stop };
  });
})();
