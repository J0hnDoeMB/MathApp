# Math eval

Casi di valutazione deterministica per il motore esatto: derivate, integrali, limiti, equazioni, fattorizzazione, matrici, vettori.

```powershell
npm run eval
```

Richiede Python + SymPy. Non usa provider AI e non consuma token: verifica il layer `lib/sympy.mjs` contro risultati attesi. `math-cases.json` è il dataset versionabile; `run-eval.mjs` è il runner.

La CI esegue questi casi dopo l'installazione di SymPy. Per valutare la qualità delle risposte AI (spiegazione, didattica, GeoGebra) serve un eval con modello reale e valutazione umana: non è in CI per costo e variabilità.
