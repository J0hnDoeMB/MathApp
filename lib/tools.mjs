// Definizione degli strumenti offerti al modello.

export function toolsFor(fullMode) {
  if (fullMode) return TOOLS;
  const disabled = new Set(["delega", "ricorda"]);
  return TOOLS.filter((t) => !(t && t.function && disabled.has(t.function.name)));
}

// Qualità tipografica delle formule: evita gli "obrobri" (tutto su una riga, *, apici...)
export const TOOLS = [
  {
    type: "function",
    function: {
      name: "sympy_compute",
      description: "Motore di calcolo simbolico ESATTO (SymPy). Usalo per derivate, integrali, limiti, equazioni, serie, semplificazioni, matrici, valutazioni numeriche, studio completo di funzione (operation \"studio\") e vettori (operation dot/cross/norm/angle/projection/independence/gram_schmidt con \"vectors\"). Restituisce risultato esatto + LaTeX.",
      parameters: {
        type: "object",
        properties: {
          operation: { type: "string", description: "simplify|diff|integrate|limit|series|expand|factor|apart|together|solve|dsolve|det|inverse|transpose|eigenvals|eigenvects|rank|rref|evaluate|latex|studio|dot|cross|norm|angle|projection|independence|gram_schmidt" },
          expr: { type: "string", description: "espressione o equazione, es. 'sin(x)/x' o 'x^2-3x+2=0'; per studio anche 'f(x)=x^2-3x+2'" },
          var: { type: "string", description: "variabile (default x)" },
          lower: { type: "string", description: "estremo inferiore per integrate definito" },
          upper: { type: "string", description: "estremo superiore per integrate definito" },
          point: { type: "string", description: "punto per limit/series, es. '0' o 'oo'" },
          order: { type: "integer", description: "ordine derivata/serie" },
          matrix: { type: "string", description: "matrice es. '[[1,2],[3,4]]'" },
          vectors: { type: "string", description: "vettori per dot/cross/norm/angle/projection/independence/gram_schmidt, es. '[[1,2],[3,4]]' (una lista per vettore)" },
          solve_for: { type: "string" },
          subs: { type: "object", description: "sostituzioni per evaluate, es. {\"x\":\"2\"}" },
        },
        required: ["operation"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "geogebra",
      description: "Disegna nell'applet GeoGebra dell'utente eseguendo comandi GeoGebra. Ogni chiamata crea una COSTRUZIONE separata, salvata nella chat e riproducibile in seguito: dagli un titolo breve. Usalo per funzioni, curve, punti, rette, cerchi, slider, animazioni.",
      parameters: {
        type: "object",
        properties: {
          title: { type: "string", description: "titolo breve della costruzione, es. 'parabola e zeri' (obbligatorio se possibile)" },
          mode: { type: "string", description: "'replace' = nuova figura che sostituisce quella sul grafico (default); 'add' = si sovrappone a quello che c'e' gia' (es. la tangente sopra la curva)" },
          view: { type: "string", description: "'3d' = vista tridimensionale (geometria solida, superfici, funzioni di due variabili); ometti o '2d' per il piano" },
          commands: { type: "array", items: { type: "string" }, description: "comandi GeoGebra in ordine, es. ['f(x)=sin(x)/x','A=(0,0)']" },
        },
        required: ["commands"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "delega",
      description: "Consulta un ALTRO modello specialista e ricevi la sua risposta, che poi integri nella tua risposta finale. Usalo quando ti manca una capacita', quando il compito e' molto difficile, o quando vuoi una verifica indipendente. Non usarlo se puoi risolvere con sympy_compute o geogebra.",
      parameters: {
        type: "object",
        properties: {
          tipo: { type: "string", description: "esperto (ragionamento difficile) | visione (immagini) | lungo (testo molto lungo) | verifica (secondo parere su un risultato)" },
          richiesta: { type: "string", description: "la domanda precisa da porre allo specialista" },
          contesto: { type: "string", description: "contesto essenziale da passare (facoltativo)" },
        },
        required: ["tipo", "richiesta"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "ricorda",
      description: "Registra una preferenza STABILE dell'utente su COME vuole le risposte (stile, formato, quanti esempi, livello di dettaglio, tono, cosa evitare). Usalo quando ti corregge sullo stile o esprime un gusto ricorrente. NON inserire esempi, formule o riferimenti a contenuti specifici: scrivi solo la regola generale (es. 'preferisce molti esempi concreti prima della teoria'). NON registrare contenuti di esercizi, dati temporanei o il tema del momento.",
      parameters: {
        type: "object",
        properties: {
          testo: { type: "string", description: "la preferenza in una riga, in terza persona (es. 'preferisce molti esempi concreti prima della teoria' oppure 'vuole sempre la verifica con SymPy')" },
        },
        required: ["testo"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "geogebra_edit",
      description: "Modifica geometria GIA' presente nell'applet GeoGebra: sposta punti, cambia il valore di slider/variabili, colori, visibilita', etichette, spessori, elimina oggetti, avvia/ferma animazioni. Usalo quando l'utente chiede di MUOVERE o CAMBIARE qualcosa (non per creare).",
      parameters: {
        type: "object",
        properties: {
          ops: {
            type: "array",
            description: "Lista di operazioni da eseguire in ordine",
            items: {
              type: "object",
              properties: {
                op: { type: "string", description: "movePoint|setValue|setColor|setVisible|setCaption|setLineThickness|setAnimating|startAnimation|stopAnimation|delete" },
                name: { type: "string", description: "nome dell'oggetto (es. 'A', 'f', 'a')" },
                x: { type: "number" }, y: { type: "number" },
                value: { type: "number" },
                r: { type: "integer" }, g: { type: "integer" }, b: { type: "integer" },
                visible: { type: "boolean" },
                text: { type: "string" },
                thickness: { type: "number" },
                on: { type: "boolean" },
              },
              required: ["op"],
            },
          },
        },
        required: ["ops"],
      },
    },
  },
];

// ---------- tools ----------
// "Strumento visione": fa trascrivere le immagini da un modello che le vede,
// così anche i modelli solo-testo possono usarle.
// ---------- SSE upstream parse ----------
