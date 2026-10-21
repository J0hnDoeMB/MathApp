// Markdown rendering and sanitization. Kept as a classic script so the app
// can load it before app.js without a build step.
(function () {
  "use strict";

  // Corregge la notazione dentro le formule: "*" -> \cdot (e evita che markdown lo renda corsivo).
  function fixMathNotation(text) {
    return String(text || "").replace(/(\$\$[\s\S]*?\$\$|\$[^$\n]+?\$)/g, (m) =>
      m.replace(/(?<!\\)\*(?![{}])/g, "\\cdot ")      // a*b -> a \cdot b
       .replace(/\\qquad/g, "\\quad ")                  // spaziatura piu' sobria
       .replace(/(\\quad\s*){2,}/g, "\\quad ")          // niente catene di spazi
    );
  }

  const SAFE_MD_TAGS = new Set([
    "a", "p", "br", "hr", "strong", "em", "del", "s", "b", "i", "u",
    "sub", "sup", "kbd", "samp", "mark", "blockquote", "pre", "code",
    "h1", "h2", "h3", "h4", "h5", "h6", "ul", "ol", "li", "table",
    "thead", "tbody", "tfoot", "tr", "th", "td", "div", "span",
  ]);
  const DROP_MD_TAGS = new Set([
    "script", "style", "iframe", "object", "embed", "svg", "math", "template",
    "noscript", "form", "input", "button", "textarea", "select", "option",
    "video", "audio", "source", "link", "meta", "base",
  ]);

  function safeMarkdownHref(raw) {
    const value = String(raw || "").trim();
    if (!value || /[\u0000-\u001f\u007f]/.test(value)) return null;
    if (value.startsWith("#")) return value;
    try {
      const url = new URL(value, window.location.href);
      return ["http:", "https:", "mailto:"].includes(url.protocol) ? value : null;
    } catch { return null; }
  }

  function copySafeMarkdownNode(source, parent) {
    if (source.nodeType === Node.TEXT_NODE) {
      parent.appendChild(document.createTextNode(source.nodeValue || ""));
      return;
    }
    if (source.nodeType !== Node.ELEMENT_NODE) return;

    const tag = source.localName.toLowerCase();
    if (DROP_MD_TAGS.has(tag)) return;
    if (!SAFE_MD_TAGS.has(tag)) {
      for (const child of source.childNodes) copySafeMarkdownNode(child, parent);
      return;
    }

    const clean = document.createElement(tag);
    if (tag === "a") {
      const href = safeMarkdownHref(source.getAttribute("href"));
      if (href) clean.setAttribute("href", href);
      const title = source.getAttribute("title");
      if (title) clean.setAttribute("title", title.slice(0, 300));
      clean.setAttribute("rel", "noopener noreferrer");
    } else if (tag === "code") {
      const language = (source.getAttribute("class") || "").split(/\s+/)
        .find((name) => /^language-[a-z0-9_+.-]{1,32}$/i.test(name));
      if (language) clean.className = language;
    } else if (tag === "ol") {
      const start = source.getAttribute("start");
      if (start && /^\d{1,5}$/.test(start)) clean.setAttribute("start", start);
    } else if (tag === "th" || tag === "td") {
      const align = source.getAttribute("align");
      if (["left", "center", "right"].includes(align)) clean.setAttribute("align", align);
    }

    for (const child of source.childNodes) copySafeMarkdownNode(child, clean);
    parent.appendChild(clean);
  }

  function sanitizeMarkdown(html) {
    // I template restano inerti: gli handler e gli script del frammento non vengono eseguiti.
    const template = document.createElement("template");
    template.innerHTML = String(html || "");
    const safe = document.createDocumentFragment();
    for (const child of template.content.childNodes) copySafeMarkdownNode(child, safe);
    return safe;
  }

  function renderMD(el, text) {
    const src = fixMathNotation(text);
    if (window.marked) el.replaceChildren(sanitizeMarkdown(window.marked.parse(src)));
    else el.textContent = src;
    if (window.renderMathInElement) {
      renderMathInElement(el, {
        delimiters: [
          { left: "$$", right: "$$", display: true },
          { left: "$", right: "$", display: false },
          { left: "\\[", right: "\\]", display: true },
          { left: "\\(", right: "\\)", display: false },
        ],
        throwOnError: false,
      });
    }
  }

  window.MathAppMarkdown = { fixMathNotation, sanitizeMarkdown, renderMD };
  window.renderMD = renderMD; // compatibilità con test e console
})();
