// Drawer accessibility: dialog semantics, focus trap, Escape and focus restore.
(function () {
  "use strict";
  const SELECTOR = "aside[id$='Drawer']";
  const drawers = Array.from(document.querySelectorAll(SELECTOR));
  if (!drawers.length) return;

  const openers = new WeakMap();
  let openDrawer = null;

  function focusable(drawer) {
    const nodes = drawer.querySelectorAll(
      "a[href], button:not([disabled]), input:not([disabled]):not([type='hidden']), " +
      "select:not([disabled]), textarea:not([disabled]), summary, [contenteditable='true'], " +
      "[tabindex]:not([tabindex='-1'])"
    );
    return Array.from(nodes).filter((el) => !el.hidden && el.getClientRects().length > 0 && !el.closest("[hidden]"));
  }

  function syncTriggers() {
    document.querySelectorAll("[aria-controls]").forEach((btn) => {
      const drawer = document.getElementById(btn.getAttribute("aria-controls"));
      if (!drawer || !drawer.matches(SELECTOR)) return;
      btn.setAttribute("aria-haspopup", "dialog");
      btn.setAttribute("aria-expanded", drawer.hidden ? "false" : "true");
    });
  }

  function openerFor(drawer) {
    const trigger = document.querySelector('[aria-controls="' + drawer.id + '"]');
    if (trigger && trigger.isConnected && !trigger.closest("[hidden]")) return trigger;
    const active = document.activeElement;
    if (active && active !== document.body && active !== document.documentElement) return active;
    return null;
  }

  function opened(drawer) {
    if (openDrawer === drawer) return;
    for (const other of drawers) {
      if (other !== drawer && !other.hidden) other.hidden = true;
    }
    openers.set(drawer, openerFor(drawer));
    openDrawer = drawer;
    drawer.setAttribute("role", "dialog");
    drawer.setAttribute("aria-modal", "true");
    drawer.setAttribute("tabindex", "-1");
    syncTriggers();
    setTimeout(() => {
      if (drawer.hidden) return;
      const target = focusable(drawer)[0] || drawer;
      try { target.focus({ preventScroll: true }); } catch { target.focus(); }
    }, 0);
  }

  function closed(drawer) {
    const opener = openers.get(drawer);
    openers.delete(drawer);
    if (openDrawer === drawer) openDrawer = null;
    syncTriggers();
    if (opener && opener.isConnected && !opener.closest("[hidden]")) {
      try { opener.focus({ preventScroll: true }); } catch { opener.focus(); }
    }
  }

  const observer = new MutationObserver((records) => {
    for (const record of records) {
      const drawer = record.target;
      if (!(drawer instanceof HTMLElement) || !drawer.matches(SELECTOR)) continue;
      if (drawer.hidden) {
        if (openDrawer === drawer) closed(drawer);
      } else {
        opened(drawer);
      }
    }
  });
  drawers.forEach((drawer) => observer.observe(drawer, { attributes: true, attributeFilter: ["hidden"] }));
  syncTriggers();

  document.addEventListener("keydown", (event) => {
    if (!openDrawer) return;
    if (event.key === "Escape") {
      if (event.defaultPrevented) { event.stopPropagation(); return; }
      event.preventDefault();
      event.stopPropagation();
      openDrawer.hidden = true;
      return;
    }
    if (event.key !== "Tab") return;
    const list = focusable(openDrawer);
    if (!list.length) { event.preventDefault(); openDrawer.focus(); return; }
    const first = list[0];
    const last = list[list.length - 1];
    const active = document.activeElement;
    if (event.shiftKey) {
      if (active === first || !openDrawer.contains(active)) { event.preventDefault(); last.focus(); }
    } else if (active === last || !openDrawer.contains(active)) {
      event.preventDefault();
      first.focus();
    }
  }, false);
})();
