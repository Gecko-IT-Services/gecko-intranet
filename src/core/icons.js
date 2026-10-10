/* The app's icons: one family (Feather/Lucide outlines on a 24 grid), one place.
   Design: docs/superpowers/specs/2026-10-10-icons-and-motion-design.md

   icon('phone') returns the SVG markup for a template string. The line weight is not set here:
   src/styles/system.css §9 draws every icon at the same weight whatever its size, and that rule
   also covers the icons written straight into index.html's markup. No top-level window access. */

export const ICONS = {
  plus:      '<path d="M12 5v14M5 12h14"/>',
  check:     '<path d="M20 6 9 17l-5-5"/>',
  x:         '<path d="M18 6 6 18M6 6l12 12"/>',
  left:      '<path d="m15 18-6-6 6-6"/>',
  right:     '<path d="m9 18 6-6-6-6"/>',
  phone:     '<path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.8 19.8 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.8 19.8 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72c.13.96.36 1.9.7 2.81a2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45c.91.34 1.85.57 2.81.7A2 2 0 0 1 22 16.92z"/>',
  incoming:  '<path d="M17 7 7 17M17 17H7V7"/>',
  outgoing:  '<path d="M7 17 17 7M7 7h10v10"/>',
  warning:   '<path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0zM12 9v4M12 17h.01"/>',
  edit:      '<path d="M12 20h9M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4z"/>',
  trash:     '<path d="M3 6h18M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>'
};

/** SVG markup for a named icon at `size` px (14 sits beside 13px button text). Unknown names draw nothing. */
export function icon(name, size = 14) {
  const d = ICONS[name];
  return d ? `<svg class="ic" width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${d}</svg>` : '';
}
