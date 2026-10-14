/**
 * The whiteboards' drop spot (Jobs, Opportunities › Pipeline): where in a column a dragged sticky would land.
 * Design: docs/superpowers/specs/2026-10-14-whiteboard-reorder-design.md. No top-level window access.
 */

/** Hand places as a Map of 'kind:id' → { col, place }, from board_places rows. */
export const placesMap = rows => new Map((rows || []).map(r => [`${r.kind}:${r.ref_id}`, { col: r.col, place: r.place }]));

/**
 * The index (0 = top) among the column's other stickies where one dragged over `zone` at height `y` would go,
 * and a line in the gap to show it (.drop-before on the sticky below, .drop-end on the column when last).
 */
export function dropSpot(zone, y) {
  clearSpot(zone.closest('.job-board') || zone);
  const others = [...zone.querySelectorAll('.job-sticky:not(.dragging)')];
  let i = others.findIndex(s => { const r = s.getBoundingClientRect(); return y < r.top + r.height / 2; });
  if (i < 0) i = others.length;
  if (others[i]) others[i].classList.add('drop-before');
  else if (others.length) zone.classList.add('drop-end');
  return i;
}

export function clearSpot(root) {
  root?.querySelectorAll('.drop-before, .drop-end').forEach(x => x.classList.remove('drop-before', 'drop-end'));
}

/**
 * Drag by touch (phones and tablets, where drag and drop needs a mouse): press and hold a sticky to lift it, then
 * move it to a column and a spot and let go. A quick swipe still scrolls, a tap still opens the sticky. While
 * lifted, the board's rail scrolls when the finger nears its side, and the page when it nears the top or bottom.
 * `drop(ref, column key, index or null)` is called on release over a column (`.job-col`) or drop zone.
 */
export function touchDrag(root, drop, { hold = 350, slop = 10 } = {}) {
  let s = null;                                    // the gesture: sticky, start point, timer, ghost
  const zoneAt = (x, y) => document.elementFromPoint(x, y)?.closest?.('[data-drop]');
  const zoneIn = z => (z && root.contains(z) ? z : null);

  const end = () => {
    if (!s) return;
    clearTimeout(s.timer); cancelAnimationFrame(s.raf);
    s.ghost?.remove();
    s.sticky.classList.remove('dragging'); s.sticky.draggable = s.draggable;
    root.querySelectorAll('.is-dragging, .drop-over').forEach(x => x.classList.remove('is-dragging', 'drop-over'));
    clearSpot(root);
    s = null;
  };

  // Each frame while lifted: scroll near an edge, then show where it would land.
  const frame = () => {
    if (!s?.lifted) return;
    const { x, y, board } = s, r = board.getBoundingClientRect(), edge = 36, step = 10;
    if (x < r.left + edge) board.scrollLeft -= step; else if (x > r.right - edge) board.scrollLeft += step;
    if (y < edge) window.scrollBy(0, -step); else if (y > innerHeight - edge) window.scrollBy(0, step);
    const z = zoneIn(zoneAt(x, y));
    root.querySelectorAll('.drop-over').forEach(o => o !== z && o.classList.remove('drop-over'));
    if (z) { z.classList.add('drop-over'); if (z.matches('.job-col')) dropSpot(z, y); else clearSpot(root); } else clearSpot(root);
    s.raf = requestAnimationFrame(frame);
  };

  const lift = () => {
    const r = s.sticky.getBoundingClientRect();
    s.lifted = true;
    s.ghost = s.sticky.cloneNode(true);
    s.ghost.classList.add('touch-ghost');
    s.ghost.removeAttribute('style');
    Object.assign(s.ghost.style, { left: `${r.left}px`, top: `${r.top}px`, width: `${r.width}px` });
    s.offX = s.x - r.left; s.offY = s.y - r.top;
    root.appendChild(s.ghost);
    s.sticky.classList.add('dragging');
    s.board.closest('[id$="Wrap"]')?.classList.add('is-dragging');
    navigator.vibrate?.(10);
    s.raf = requestAnimationFrame(frame);
  };

  root.addEventListener('pointerdown', e => {
    if (e.pointerType === 'mouse' || s) return;
    const sticky = e.target.closest?.('.job-sticky[data-drag]');
    if (!sticky || e.target.closest('button, select, a, input, textarea')) return;
    // iOS starts its own drag on a held draggable element: not while this one is in charge.
    s = { sticky, board: sticky.closest('.job-board'), id: e.pointerId, x: e.clientX, y: e.clientY, x0: e.clientX, y0: e.clientY, draggable: sticky.draggable };
    sticky.draggable = false;
    s.timer = setTimeout(lift, hold);
  });
  root.addEventListener('pointermove', e => {
    if (!s || e.pointerId !== s.id) return;
    s.x = e.clientX; s.y = e.clientY;
    if (!s.lifted) { if (Math.hypot(s.x - s.x0, s.y - s.y0) > slop) end(); return; }   // moving first: a scroll
    s.ghost.style.transform = `translate(${s.x - s.x0}px, ${s.y - s.y0}px) rotate(2deg)`;
  });
  root.addEventListener('pointerup', e => {
    if (!s || e.pointerId !== s.id) return;
    if (!s.lifted) { end(); return; }                                   // a tap: the click opens the sticky
    const moved = Math.hypot(s.x - s.x0, s.y - s.y0) > slop;
    const z = moved ? zoneIn(zoneAt(s.x, s.y)) : null;
    const index = z?.matches('.job-col') ? dropSpot(z, s.y) : null;
    const ref = s.sticky.dataset.drag;
    // The click that follows a drag is not a tap.
    const swallow = ev => { ev.stopPropagation(); ev.preventDefault(); };
    root.addEventListener('click', swallow, { capture: true, once: true });
    setTimeout(() => root.removeEventListener('click', swallow, { capture: true }), 400);
    end();
    if (z) drop(ref, z.dataset.drop, index);
  });
  root.addEventListener('pointercancel', e => { if (s && e.pointerId === s.id) end(); });
  // While lifted the finger moves the sticky, not the page; and a long press is not a menu.
  root.addEventListener('touchmove', e => { if (s?.lifted) e.preventDefault(); }, { passive: false });
  root.addEventListener('contextmenu', e => { if (s) e.preventDefault(); });
}
