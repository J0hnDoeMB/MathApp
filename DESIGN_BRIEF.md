# DESIGN BRIEF — MathApp (redesign della UI)

Sei il design lead di uno studio noto per dare a ogni cliente un'identità visiva riconoscibile.
Il cliente ha già rifiutato proposte "da template": servono scelte deliberate e opinionate su palette,
tipografia e layout, con **un vero rischio estetico giustificabile**.

## Cos'è il prodotto
**MathApp** è un tutor di matematica che gira in locale sul PC dell'utente. La pagina ha un solo lavoro:
far dialogare l'utente con un'IA di matematica (in italiano) e, quando serve, mostrare una figura
GeoGebra interattiva. L'utente scrive una domanda; l'IA risponde con testo + formule in LaTeX, e può
disegnare/modificare una figura nell'applet GeoGebra accanto.

Pubblico: una persona che studia matematica all'università. Contesto d'uso: studio prolungato, lettura
di formule, alternanza "leggo la spiegazione" / "guardo e manipolo il grafico".

## Obiettivo del redesign
Una UI che sembri disegnata per QUESTA app, non un template. Deve essere bella, ma soprattutto
**ottima da leggere per la matematica** (formule, simboli, numeri) e chiara nel separare i due mondi:
"spiegazione scritta" e "figura interattiva".

## Vincoli TECNICI (obbligatori — non rompere l'app)
Il file `public/index.html` deve mantenere ESATTAMENTE questi id e classi (il JavaScript li cerca per nome):
- `<select id="model">`, `<button id="toggleGgb">`, `<button id="newChat">`, `<span id="status">`
- `<main id="main">`
- `#ggbwrap` che contiene `#ggb`
- `#divider` (divisore trascinabile tra le due aree)
- `#chatpanel` che contiene `#chat`
- `<form id="composer">` con `<textarea id="input">` e `<button id="send" type="submit">`
- i messaggi vengono creati dal JS con classi: `msg user` / `msg assistant`, e dentro possono comparire
  `.thinking`, `.tools`, `.err`; la classe `ggb-hidden` viene aggiunta a `#main` per nascondere GeoGebra.
- Mantieni i tag `<script>`/`<link>` esistenti (KaTeX, marked, deployggb, /app.js, /style.css).
- L'applet GeoGebra viene iniettata in `#ggb` e deve riempire il suo contenitore (`width/height:100%`).

## Cosa consegnare
Scrivi DUE file:
1. `public/index.new.html` — la nuova struttura (stessi id/classi sopra).
2. `public/style.new.css` — il nuovo stile completo (sostituirà `style.css`).
NON modificare `public/app.js`, `server.mjs` o altri file.

## Indicazioni di design (seguile)
- **Ancorati al soggetto**: la matematica ha un suo mondo — carta millimetrata, righello, compasso,
  lavagna, quaderno, inchiostro, dimostrazione. Trai da lì, non dai soliti default.
- **Evita i tre cliché dell'AI**: (1) sfondo crema + serif ad alto contrasto + accento terracotta;
  (2) sfondo quasi nero + un unico accento verde acido/vermiglio; (3) layout "broadsheet" con filetti
  sottili e colonne da giornale. Se scegli qualcosa di simile, giustificalo col brief; altrimenti distinguiti.
- **Tipografia = personalità**: scegli una coppia display+testo deliberata (non i soliti Inter/Playfair).
  Definisci una scala tipografica con pesi e spaziature intenzionali. Le formule matematica devono avere
  un corpo leggibile e un'interlinea generosa; il testo dell'IA va reso come una pagina di quaderno ben
  composta.
- **La struttura è informazione**: i divisori/etichette devono codificare qualcosa di vero (es. separare
  "spiegazione" da "figura"), non decorare.
- **Un solo elemento firma**: l'unica cosa memorabile della pagina (un dettaglio ricorrente che richiami
  la matematica). Tutto il resto deve restare sobrio e disciplinato.
- **Motion con misura**: micro-interazioni (es. comparsa dei messaggi, transizione del pannello figura).
  Rispetta `prefers-reduced-motion`.
- Qualità minima: **responsive** (fino a mobile), **focus da tastiera visibile**, contrasto adeguato.
- Scrivi anche il microcopy dei pulsanti in italiano chiaro (es. "Nascondi figura" invece di "Nascondi GeoGebra"
  se migliora la chiarezza, ma l'id resta `toggleGgb`).

## Palette e tipografia: decidi tu e motiva
Consegna, in testa a `style.new.css` come commento, un piccolo sistema di token: 4–6 colori (hex nominati),
2–3 ruoli tipografici con i font (usa Google Fonts via CDN), e in 2 righe l'idea di layout e l'elemento firma.

## Qualità
Fai attenzione alle specificità CSS (evita regole che si annullano a vicenda). Non usare emoji nel codice.
Consegna codice pulito e leggibile.
