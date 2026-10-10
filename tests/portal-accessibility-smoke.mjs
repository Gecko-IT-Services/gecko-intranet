import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const html = await readFile(new URL('../index.html', import.meta.url), 'utf8');

const navButtons = html.match(/<button class="sb-link\b[^>]*data-section=/g) ?? [];
// 9 original sections + Projects + Backups + Alerts, minus Projects,
// Compliance and P&L taken off the sidebar on 6 Oct 2026 (their code removed 9 Oct 2026),
// plus Opportunities (8 Oct 2026). 9 Oct 2026 (Philip): 8 entries, with hubs: Clients (Directory,
// Profitability, client page), Monitoring (Backups, Alerts), Team (Leave, Mileage).
// 10 Oct 2026: Analytics added under Home (9).
assert.equal(navButtons.length, 9, 'every sidebar destination should be a semantic button');
assert.equal((html.match(/<button class="sb-link\b[^>]*data-hub=/g) ?? []).length, 3, 'three hubs');
assert.doesNotMatch(html, /<div class="sb-link\b[^>]*onclick=/, 'sidebar destinations must not be click-only divs');
assert.match(html, /id="sbToggle"[^>]*aria-controls="sidebar"[^>]*aria-expanded="false"/, 'the mobile menu control should expose its target and state');
assert.match(html, /id="sbBackdrop"[^>]*type="button"[^>]*aria-label="Close navigation"/, 'the mobile backdrop should be an accessible dismissal control');
assert.match(html, /id="sbBackdrop"[^>]*tabindex="-1"/, 'the closed mobile backdrop must stay out of the tab order');
assert.match(html, /<aside class="sidebar" id="sidebar" inert aria-hidden="true">/, 'the initially closed mobile drawer must not expose its controls to assistive technology');
assert.doesNotMatch(html, /<nav\b[^>]*\brole="navigation"/, 'native nav landmarks must not use a redundant role');
assert.doesNotMatch(html, /class="sb-system-card"/, 'the Connected Workspace card was removed (Philip, 9 Oct 2026)');
assert.match(html, /class="prf-month-btn"[^>]*aria-label="Previous month"/, 'previous month controls need an accessible name');
assert.match(html, /class="prf-month-btn"[^>]*aria-label="Next month"/, 'next month controls need an accessible name');
assert.match(html, /:focus-visible\s*\{/, 'keyboard users need a visible focus indicator');
assert.match(html, /@media \(prefers-reduced-motion: reduce\)/, 'motion-sensitive users need a reduced-motion fallback');
assert.match(html, /#signInBtn\s*\{[^}]*min-height:\s*44px;/s, 'the sign-in control should meet the minimum touch-target height');
assert.match(html, /<span data-signin-label>Sign in with Microsoft<\/span>/, 'the sign-in action needs a dedicated status label');
assert.match(html, /btn\.setAttribute\('aria-busy', 'true'\)/, 'sign-in should expose its in-progress state to assistive technology');
assert.match(html, /btn\.removeAttribute\('aria-busy'\)/, 'sign-in should clear its in-progress state after it completes');
assert.doesNotMatch(html, /console\.log\(/, 'production code should not include debug console logging');
assert.doesNotMatch(html, /\.toast\s*\{[^}]*border-left-width:\s*3px;/s, 'toasts should not use a decorative side stripe');
assert.doesNotMatch(html, /\.sb-link\.active::before\s*\{/, 'the active navigation state must not recreate a decorative side stripe');
assert.doesNotMatch(html, /\.login-card\s*,\s*\.card:hover/, 'the login card should not inherit the card-hover shadow');
assert.match(html, /function openSidebar\(\)[\s\S]*?\.focus\(/, 'opening mobile navigation should move keyboard focus into the drawer');
assert.match(html, /function closeSidebar\([^)]*\)[\s\S]*?\.focus\(/, 'closing mobile navigation should restore keyboard focus');
assert.match(html, /event\.key === 'Escape'[\s\S]*?closeSidebar\(/, 'the open mobile drawer should close with Escape');
assert.match(html, /event\.key === 'Tab'[\s\S]*?preventDefault\(/, 'keyboard focus should remain inside an open mobile drawer');
assert.match(html, /function syncSidebarAccessibility\(\)[\s\S]*?toggleAttribute\('inert', !open\)/, 'mobile drawer accessibility state must follow its open state');
assert.doesNotMatch(html, /heading\.focus\(\{ preventScroll: true \}\)/, 'focus should scroll a newly selected mobile destination into view');

// Pin the production escapeHtml so it keeps escaping quotes.
assert.match(
  html,
  /function escapeHtml[\s\S]{0,80}\[&<>"'\]/,
  'escapeHtml must still escape quotes'
);

console.log('Portal accessibility and visual-system smoke checks passed.');
