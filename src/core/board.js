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
