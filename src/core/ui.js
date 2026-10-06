/** Thin re-exports of the UI helpers still defined in index.html. See core/graph.js. */
export const toast      = (message, type, ms) => window.toast(message, type, ms);
export const escapeHtml = (s) => window.escapeHtml(s);

/** Stamp phone-card labels onto any 4+ column table under `root` (see RESPONSIVE TABLES in index.html). */
export const syncTableLabels = (root) => window.syncTableLabels?.(root);
