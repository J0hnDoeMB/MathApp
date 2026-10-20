// Plugin UI opzionale: quiz a risposta multipla.
(function () {
  MathAppPlugins.register("quiz", function init(app) {
    const $ = app.$;
    const flash = app.flash;
    const quizDrawer = $("#quizDrawer");
    let quizState = null; // { questions, answers, graded, deadline, timerId, timeUp }

    function stopQuizTimer() {
      if (quizState && quizState.timerId) { clearInterval(quizState.timerId); quizState.timerId = null; }
    }

    function updateQuizHint() {
      if (!quizState || quizState.graded) return;
      const done = quizState.answers.filter((a) => a != null).length;
      $("#quizHint").textContent = done + " di " + quizState.questions.length + " risposte";
    }

    function renderQuiz() {
      const list = $("#quizList");
      list.innerHTML = "";
      quizState.questions.forEach((q, qi) => {
        const card = document.createElement("div");
        card.className = "quiz-q";
        const title = document.createElement("div");
        title.className = "quiz-d";
        title.textContent = (qi + 1) + ". " + q.d;
        card.appendChild(title);
        q.opts.forEach((opt, oi) => {
          const lab = document.createElement("label");
          lab.className = "quiz-opt";
          const inp = document.createElement("input");
          inp.type = "radio";
          inp.name = "quizq" + qi;
          inp.value = String(oi);
          inp.disabled = !!quizState.graded;
          if (quizState.answers[qi] === oi) inp.checked = true;
          if (quizState.graded) {
            if (oi === q.ok) lab.classList.add("ok");
            else if (quizState.answers[qi] === oi) lab.classList.add("ko");
          }
          inp.addEventListener("change", () => { quizState.answers[qi] = oi; updateQuizHint(); });
          const span = document.createElement("span");
          span.textContent = opt;
          lab.append(inp, span);
          card.appendChild(lab);
        });
        if (quizState.graded) {
          const giusta = quizState.answers[qi] === q.ok;
          const fb = document.createElement("div");
          fb.className = giusta ? "quiz-fb" : "quiz-fb ko";
          fb.textContent = (giusta ? "✓ giusta" : "✗ sbagliata — risposta corretta: " + q.opts[q.ok]) + (q.why ? " — " + q.why : "");
          card.appendChild(fb);
        }
        list.appendChild(card);
      });
    }

    async function quizGenerate() {
      const topic = $("#quizTopic").value.trim();
      if (topic.length < 3) { flash("scrivi l'argomento del quiz"); return; }
      const n = Math.max(3, Math.min(10, Number($("#quizN").value) || 5));
      stopQuizTimer();
      quizState = null;
      $("#quizTimer").hidden = true;
      $("#quizGrade").hidden = true;
      $("#quizHint").textContent = "le risposte sbagliate finiscono nel Ripasso";
      const list = $("#quizList");
      list.innerHTML = "";
      const attesa = document.createElement("div");
      attesa.className = "quiz-note";
      attesa.textContent = "sto preparando le domande...";
      list.appendChild(attesa);
      $("#quizStart").disabled = true;
      try {
        const r = await fetch("/api/quiz", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ topic, n }) });
        const j = await r.json();
        if (!j.ok || !Array.isArray(j.questions) || !j.questions.length) { list.innerHTML = ""; flash(j.error || "quiz non disponibile"); return; }
        quizState = { questions: j.questions, answers: [], graded: false, deadline: 0, timerId: null, timeUp: false };
        renderQuiz();
        $("#quizGrade").hidden = false;
        updateQuizHint();
        if ($("#quizTimed").checked) startQuizTimer(n);
      } catch { list.innerHTML = ""; flash("errore nella generazione del quiz"); }
      finally { $("#quizStart").disabled = false; }
    }

    function startQuizTimer(minutes) {
      if (!quizState) return;
      quizState.deadline = Date.now() + minutes * 60 * 1000;
      const el = $("#quizTimer");
      el.hidden = false;
      const tick = () => {
        if (!quizState || quizState.graded) return;
        const left = Math.max(0, quizState.deadline - Date.now());
        const mm = Math.floor(left / 60000), ss = Math.floor((left % 60000) / 1000);
        el.textContent = "⏱ " + mm + ":" + String(ss).padStart(2, "0");
        if (left <= 0) { stopQuizTimer(); quizGrade(true); }
      };
      tick();
      quizState.timerId = setInterval(tick, 1000);
    }

    async function quizGrade(timeUp) {
      if (!quizState || quizState.graded) return;
      quizState.graded = true;
      quizState.timeUp = !!timeUp;
      stopQuizTimer();
      const qs = quizState.questions;
      let ok = 0;
      const wrong = [];
      qs.forEach((q, i) => { if (quizState.answers[i] === q.ok) ok++; else wrong.push(i); });
      renderQuiz();
      $("#quizGrade").hidden = true;
      const esito = document.createElement("div");
      esito.className = "quiz-score";
      const pct = Math.round((ok / qs.length) * 100);
      esito.textContent = "punteggio: " + ok + " su " + qs.length + " (" + pct + "%)" + (timeUp ? " — tempo scaduto" : "") + (ok === qs.length ? " — en plein!" : "");
      $("#quizList").prepend(esito);
      $("#quizHint").textContent = wrong.length ? "gli errori sono finiti nel Ripasso" : "tutto giusto, niente da ripassare";
      for (const i of wrong) {
        try {
          await fetch("/api/review", {
            method: "POST", headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              convId: "quiz",
              title: qs[i].d,
              text: qs[i].opts[qs[i].ok] + (qs[i].why ? " — " + qs[i].why : ""),
            }),
          });
        } catch {}
      }
      if (wrong.length && app.refreshReviewBadge) app.refreshReviewBadge();
    }

    $("#quizBtn").addEventListener("click", () => { quizDrawer.hidden = !quizDrawer.hidden; if (!quizDrawer.hidden) $("#quizTopic").focus(); });
    $("#quizClose").addEventListener("click", () => { quizDrawer.hidden = true; stopQuizTimer(); });
    $("#quizStart").addEventListener("click", quizGenerate);
    $("#quizGrade").addEventListener("click", () => quizGrade(false));
    $("#quizTopic").addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); quizGenerate(); } });

    window.__quiz = { get: () => quizState, forceTimeUp: () => { if (quizState && !quizState.graded) quizState.deadline = Date.now() - 1; } };
  });
})();
