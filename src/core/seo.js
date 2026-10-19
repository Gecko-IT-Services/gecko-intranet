/* SEO (Philip, 19 Oct 2026: "ALS and Clarke Lane use us for SEO so we need to stay on top of it… CDA to hopefully follow"). Turns a site
   check (Edge Function seo-check) into plain findings with the fix, and a site's month into a status: checked, worked on, problems.
   Pure: no window. Tests: tests/seo.mjs. Design: docs/superpowers/specs/2026-10-20-seo-design.md */

export const STATUS = [['active', 'Active'], ['setup', 'Setting up'], ['proposed', 'Proposed'], ['paused', 'Paused']];
export const WORK_BY_DAY = 15;     // an active site with no work logged by the 15th: Do next says so
export const SLOW_MS = 3000;

/** What a check found that needs doing, worst first → [{ level: 'red'|'amber'|'info', text, fix }]. */
export function findings(check) {
  if (!check) return [];
  if (check.error) return [{ level: 'red', text: check.error, fix: 'Check the site is up, and the domain and hosting are paid.' }];
  const p = check.onpage || {};
  const out = [];
  const add = (level, text, fix) => out.push({ level, text, fix });
  if (p.status && p.status >= 400) add('red', `The home page answered ${p.status}`, 'Get the site back up first: nothing else counts while it’s down.');
  if (p.noindex) add('red', 'It tells Google not to list it (noindex)', 'Turn off “Discourage search engines” in WordPress (Settings › Reading) or Rank Math’s noindex.');
  if (p.robotsBlocksAll) add('red', 'robots.txt blocks every search engine', 'Remove “Disallow: /” from robots.txt.');
  if (p.https === false) add('red', p.httpsError ? 'The secure (https) version is broken: browsers show “Not secure”' : 'It doesn’t open on https',
    p.httpsError ? `Fix the SSL certificate (${p.httpsError}) and redirect http to https; Google ranks secure sites higher.` : 'Redirect http to https; Google ranks secure sites higher.');
  if (!p.title) add('red', 'The home page has no title', 'Set an SEO title in Rank Math: business, service and town.');
  else if (p.titleLength > 60) add('amber', `The title is ${p.titleLength} characters; Google shows about 60`, 'Shorten it so the important words come first.');
  else if (p.titleLength < 20) add('amber', `The title is only ${p.titleLength} characters`, 'Say what they do and where, e.g. “Locksmith in Lymington | ALS”.');
  if (!p.description) add('amber', 'No meta description', 'Write one (about 150 characters) in Rank Math: it’s the text under the link in Google.');
  else if (p.descriptionLength > 160) add('amber', `The description is ${p.descriptionLength} characters; Google cuts it at about 155`, 'Trim it so it isn’t cut off.');
  if (!(p.h1 || []).length) add('amber', 'No main heading (H1) on the home page', 'Give the page one H1 saying what they do and where.');
  else if (p.h1.length > 1) add('info', `${p.h1.length} main headings (H1)`, 'One H1 is clearest; make the others H2.');
  if (!p.sitemap) add('amber', 'No sitemap found', 'Turn on Rank Math’s sitemap and submit it in Google Search Console.');
  if (p.viewport === false) add('amber', 'Not set up for phones (no viewport)', 'Most searches are on phones: fix the theme’s mobile set-up.');
  if (p.ms > SLOW_MS) add('amber', `The home page took ${(p.ms / 1000).toFixed(1)}s to load`, 'Look at caching, image sizes and the hosting plan.');
  if (!(p.schemaTypes || []).some(t => /LocalBusiness|Organization|Locksmith|Store|ProfessionalService|HomeAndConstructionBusiness/i.test(t)))
    add('info', 'No business details for Google (schema)', 'Fill in Rank Math › Titles & Meta › Local SEO: name, address, phone, hours.');
  if (p.imagesNoAlt) add('info', `${p.imagesNoAlt} of ${p.images} images have no description (alt text)`, 'Describe each image; it helps image search and accessibility.');
  if (p.wordpress && !p.rankMath) add('info', 'WordPress without Rank Math', 'Install Rank Math, as on our other SEO sites.');
  const s = check.pagespeed;
  if (s && !s.error) {
    if (s.performance != null && s.performance < 50) add('amber', `Google’s mobile speed score is ${s.performance}/100`, 'Compress images and cache pages; slow sites rank lower.');
    if (s.seo != null && s.seo < 90) add('amber', `Google’s SEO score is ${s.seo}/100`, 'Open PageSpeed Insights for the exact items.');
  }
  const rank = { red: 0, amber: 1, info: 2 };
  return out.sort((a, b) => rank[a.level] - rank[b.level]);
}

/**
 * One site's state → { site, last, previous, findings, scores, work (this month), lastWork, flags }. checks: that site's seo_checks,
 * newest first; work: its seo_work rows; fee: £ a month from Xero (or 0); today: YYYY-MM-DD.
 */
export function siteState(site, { checks = [], work = [], fee = 0, today }) {
  const month = today.slice(0, 7);
  const last = checks[0] || null, previous = checks[1] || null;
  const f = findings(last);
  const thisMonth = work.filter(w => String(w.done_on).slice(0, 7) === month).sort((a, b) => String(b.done_on).localeCompare(String(a.done_on)));
  const lastWork = [...work].sort((a, b) => String(b.done_on).localeCompare(String(a.done_on)))[0] || null;
  const flags = [];
  if (!last) flags.push('unchecked');
  if (f.some(x => x.level === 'red')) flags.push('problem');
  if (site.status === 'active' && !thisMonth.length && Number(today.slice(8, 10)) >= WORK_BY_DAY) flags.push('no-work');
  return { site, last, previous, findings: f, scores: last?.pagespeed && !last.pagespeed.error ? last.pagespeed : null, fee,
    work: thisMonth, minutes: thisMonth.reduce((t, w) => t + (Number(w.minutes) || 0), 0), lastWork, flags };
}

/** "£500.00 a month" from Xero repeating lines that mention SEO, for one client (lines: [{ contact_name, line_items }]). */
export function seoFee(repeating, sameClient, client) {
  return Math.round((repeating || []).filter(r => r.status === 'AUTHORISED' && Number(r.period || 1) === 1 && sameClient(r.contact_name, client))
    .flatMap(r => r.line_items || []).filter(l => /\bseo\b|search engine/i.test(l.description || ''))
    .reduce((t, l) => t + Number(l.line_amount || 0), 0) * 100) / 100;
}
