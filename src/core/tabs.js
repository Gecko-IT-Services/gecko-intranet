/* One tab strip for the whole app (the Jobs look, Philip 8 Oct): a pill with a sliding green
   ink, arrow-key navigation, and panes that slide in from the side the tab is on.
   Styles: src/styles/app.css (.app-tabs). No top-level window access. */

const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

/**
 * The strip's buttons: tabs = [{ key, label, badge?, warn?, title? }]. `attr` is the data
 * attribute that carries the key (e.g. 'data-client-tab'); `controls` the panel's id.
 */
export function tabsHtml(tabs, active, { attr = 'data-tab', controls = '', label = 'Views' } = {}) {
  return `<div class="app-tabs" role="tablist" aria-label="${esc(label)}">${tabs.map(t => {
    const on = t.key === active;
    return `<button type="button" role="tab" ${attr}="${esc(t.key)}" aria-selected="${on}" tabindex="${on ? 0 : -1}"${controls ? ` aria-controls="${esc(controls)}"` : ''}${t.title ? ` title="${esc(t.title)}"` : ''}>
      <span>${esc(t.label)}</span>${t.badge != null && t.badge !== '' ? `<b class="app-tab-badge${t.warn ? ' warn' : ''}">${esc(t.badge)}</b>` : ''}</button>`;
  }).join('')}<i class="app-tab-ink" aria-hidden="true"></i></div>`;
}

/** Slide the ink under the selected tab (call after the strip is in the page and visible). */
export function moveInk(strip) {
  const ink = strip?.querySelector('.app-tab-ink');
  const on = strip?.querySelector('[aria-selected="true"]');
  if (!ink || !on) return;
  requestAnimationFrame(() => {
    ink.style.width = on.offsetWidth + 'px';
    ink.style.transform = `translateX(${on.offsetLeft}px)`;
    if (strip.scrollWidth > strip.clientWidth) on.scrollIntoView({ block: 'nearest', inline: 'nearest', behavior: 'smooth' });
  });
}

/** Arrow keys / Home / End across a strip's tabs: calls pick(key) and keeps focus on the new tab. */
export function keyNav(event, attr, pick) {
  const tab = event.target.closest?.(`.app-tabs [${attr}]`);
  if (!tab || !['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return false;
  const all = [...tab.parentElement.querySelectorAll(`[${attr}]`)];
  const i = all.indexOf(tab);
  const next = event.key === 'Home' ? all[0] : event.key === 'End' ? all.at(-1)
    : all[(i + (event.key === 'ArrowRight' ? 1 : -1) + all.length) % all.length];
  event.preventDefault();
  const key = next.getAttribute(attr);
  pick(key);
  tab.parentElement.parentElement?.querySelector(`[${attr}="${CSS.escape(key)}"]`)?.focus();
  return true;
}

/** Which way a new pane slides in: from the right when moving to a later tab. */
export function direction(keys, from, to) {
  return keys.indexOf(to) >= keys.indexOf(from) ? 'from-right' : 'from-left';
}
