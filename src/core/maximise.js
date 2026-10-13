/**
 * Maximise: a whiteboard on its own (Jobs, Opportunities › Pipeline).
 *
 * `.is-max` on the section makes the sidebar, the heading, the tabs and the figures step aside (jobs.css) and the
 * browser goes full screen where it can. Esc or the same button returns. Not remembered: a page always opens as usual.
 * Design: docs/superpowers/specs/2026-10-13-jobs-maximise-design.md.
 */
import { icon } from './icons.js';

/**
 * Wire a section's header button. Returns a function for the section's render to call with whether the whiteboard is
 * on show: it draws the button, and leaves the maximised view when the whiteboard is not there to fill the screen.
 */
export function maximiser(sectionId, buttonId) {
  const section = document.getElementById(sectionId), btn = document.getElementById(buttonId);
  if (!section || !btn) return () => {};
  const on = () => section.classList.contains('is-max');
  const draw = () => {
    btn.setAttribute('aria-pressed', String(on()));
    btn.title = on() ? 'Back to the normal view (Esc)' : 'The whiteboard on its own, full screen';
    btn.innerHTML = `${icon(on() ? 'minimize' : 'maximize', 14)}${on() ? 'Exit full screen' : 'Maximise'}`;
  };
  const set = to => {
    section.classList.toggle('is-max', to);
    // An iPhone has no full screen and a browser may refuse it: the page still clears.
    if (to) document.documentElement.requestFullscreen?.()?.catch(() => {});
    else if (document.fullscreenElement) document.exitFullscreen?.()?.catch(() => {});
    draw();
  };
  btn.addEventListener('click', () => set(!on()));
  // Esc in full screen goes to the browser, not the page: follow it out. Without full screen the page's own Esc, but not from a form.
  document.addEventListener('fullscreenchange', () => { if (!document.fullscreenElement && on()) set(false); });
  section.addEventListener('keydown', event => {
    if (event.key === 'Escape' && on() && !event.target.closest?.('input, textarea, select')) set(false);
  });
  return show => {
    btn.hidden = !show;
    if (!show && on()) set(false); else draw();
  };
}
