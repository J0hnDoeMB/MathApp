# Math eval

Casi di valutazione deterministica per il motore esatto: derivate, integrali, limiti, equazioni, fattorizzazione, matrici, vettori.

```powershell
npm run eval
```

Richiede Python + SymPy. Non usa provider AI e non consuma token: verifica il layer `lib/sympy.mjs` contro risultati attesi. `math-cases.json` è il dataset versionabile; `run-eval.mjs` è il runner.

La CI esegue questi casi dopo l'installazione di SymPy. Per valutare la qualit? delle risposte AI (spiegazione, didattica, GeoGebra) c'? un harness opzionale con modello reale:

```bash
MATHAPP_AI_EVAL_KEY=... npm run eval:ai
# opzionali: MATHAPP_AI_EVAL_BASE (default OpenRouter), MATHAPP_AI_EVAL_MODEL
```

Senza `MATHAPP_AI_EVAL_KEY` il comando esce con SKIP. Non ? in CI: costa token, richiede rete e la qualit? didattica va comunque rivista da una persona. La chiave non viene mai scritta nei log.
