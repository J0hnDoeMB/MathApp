// Dettatura vocale: registrazione, invio a Whisper locale e stato del pulsante.
// La trascrizione resta sul PC; nessun audio viene salvato su disco.
(function () {
  "use strict";

  function create(deps) {
    const { inputEl, flash, button } = deps;
    const b = button || document.getElementById("micBtn");
    let mediaRec = null, recChunks = [], recTimer = null, recStart = 0, recBusy = false;
    let micBusyTimer = null;

    function b64FromBlob(blob) {
      return new Promise((resolve) => {
        const fr = new FileReader();
        fr.onload = () => { const s = String(fr.result || ""); resolve(s.slice(s.indexOf(",") + 1)); };
        fr.readAsDataURL(blob);
      });
    }

    async function transcribeBlob(blob) {
      flash("trascrivo in locale\u2026 (pu\u00f2 richiedere qualche secondo)");
      try {
        const b64 = await b64FromBlob(blob);
        const r = await fetch("/api/transcribe", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ b64 }),
        });
        const j = await r.json();
        if (j && j.ok && j.text) {
          inputEl.value = (inputEl.value.trim() ? inputEl.value.replace(/\s+$/, "") + " " : "") + j.text;
          inputEl.focus();
          flash("trascrizione pronta (" + j.language + " " + Math.round((j.language_probability || 0) * 100) + "%): controlla e invia");
        } else if (j && j.ok) {
          flash("non ho sentito nulla: riprova parlando pi\u00f9 vicino al microfono");
        } else {
          flash("trascrizione non riuscita: " + ((j && j.error) || "errore"));
        }
      } catch (e) {
        flash("trascrizione non riuscita: " + e.message);
      }
    }

    function setMicBusy(on) {
      if (!b) return;
      if (on) {
        recBusy = true;
        clearInterval(recTimer);
        b.classList.remove("recording");
        b.classList.add("transcribing");
        b.disabled = true;
        const t0 = Date.now();
        const tick = () => { b.textContent = "\u2026 " + Math.round((Date.now() - t0) / 1000) + "s"; };
        tick();
        micBusyTimer = setInterval(tick, 500);
      } else {
        recBusy = false;
        clearInterval(micBusyTimer);
        micBusyTimer = null;
        b.classList.remove("transcribing");
        b.disabled = false;
        b.textContent = "Mic";
      }
    }

    async function toggleMic() {
      if (recBusy) return;
      if (mediaRec && mediaRec.state === "recording") { mediaRec.stop(); return; }
      try {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        const type = MediaRecorder.isTypeSupported("audio/webm") ? "audio/webm" : (MediaRecorder.isTypeSupported("audio/ogg") ? "audio/ogg" : "");
        mediaRec = type ? new MediaRecorder(stream, { mimeType: type }) : new MediaRecorder(stream);
        recChunks = [];
        mediaRec.ondataavailable = (e) => { if (e.data && e.data.size) recChunks.push(e.data); };
        mediaRec.onstop = async () => {
          try { stream.getTracks().forEach((t) => t.stop()); } catch {}
          clearInterval(recTimer);
          const blob = new Blob(recChunks, { type: mediaRec.mimeType || "audio/webm" });
          if (blob.size > 800) {
            setMicBusy(true);
            try { await transcribeBlob(blob); } finally { setMicBusy(false); }
          } else {
            if (b) {
              b.classList.remove("recording");
              b.textContent = "Mic";
            }
            flash("registrazione troppo breve");
          }
        };
        mediaRec.start();
        recStart = Date.now();
        if (b) {
          b.classList.add("recording");
          b.textContent = "\u25cf 0s";
        }
        recTimer = setInterval(() => {
          const s = Math.round((Date.now() - recStart) / 1000);
          if (b) b.textContent = "\u25cf " + s + "s";
          if (s >= 120) mediaRec.stop();
        }, 250);
        flash("registro\u2026 premi di nuovo per fermare");
      } catch (e) {
        flash("microfono non disponibile: " + e.message);
      }
    }

    if (b) b.addEventListener("click", toggleMic);
    return { b64FromBlob, toggleMic };
  }

  window.MathAppAudio = { create };
})();
