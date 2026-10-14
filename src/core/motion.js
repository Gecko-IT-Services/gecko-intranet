/**
 * Motion a redraw would otherwise lose or repeat. A section draws by replacing its markup, so anything with an
 * entrance plays it again on every redraw, and anything that moved simply turns up in its new place.
 * Design: docs/superpowers/specs/2026-10-13-motion-review-design.md. No top-level window access.
 */

/** Replace `mount`'s markup. Whatever is pinned open (`data-pin="<what>"`) and was already showing keeps still (`.still`). */
export function redraw(mount, html) {
  const was = new Set([...mount.querySelectorAll('[data-pin]')].map(el => el.dataset.pin));
  mount.innerHTML = html;
  mount.querySelectorAll('[data-pin]').forEach(el => el.classList.toggle('still', was.has(el.dataset.pin)));
}

/**
 * Run `draw` with the stickies gliding to their new places (each carries a `view-transition-name`), where the browser
 * has view transitions and the person has not asked for less motion; a plain redraw otherwise.
 */
export function glide(draw) {
  // A page not on screen gets no frames, and the browser holds the redraw back until it has one: draw now instead.
  if (!document.startViewTransition || document.visibilityState !== 'visible' || matchMedia('(prefers-reduced-motion: reduce)').matches) { draw(); return; }
  // The browser may still skip the movement (window resized mid-way); `draw` has run all the same.
  document.startViewTransition(draw).ready.catch(() => {});
}
