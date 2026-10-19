import assert from 'node:assert/strict';
import { findings, siteState, seoFee, WORK_BY_DAY, searchSummary, sparkline } from '../src/core/seo.js';

const good = { onpage: { status: 200, https: true, ms: 900, title: 'Locksmith in Lymington & the New Forest | ALS', titleLength: 47,
  description: 'Fast, friendly local locksmiths covering Lymington, Brockenhurst and the New Forest. 24 hour call-out, no call-out fee.', descriptionLength: 118,
  h1: ['New Forest Locksmith'], sitemap: 'https://newforestlocksmith.com/sitemap_index.xml', viewport: true, schemaTypes: ['WebSite', 'Locksmith'],
  images: 10, imagesNoAlt: 0, wordpress: true, rankMath: true } };
assert.deepEqual(findings(good), [], 'a healthy page: nothing to do');
assert.deepEqual(findings(null), []);
assert.deepEqual(findings({ error: 'The site didn’t load: timeout' }).map(f => f.level), ['red']);

const bad = { onpage: { ...good.onpage, noindex: true, https: false, title: '', titleLength: 0, description: 'x'.repeat(200), descriptionLength: 200, h1: [],
  sitemap: '', ms: 4200, schemaTypes: [], imagesNoAlt: 3, rankMath: false }, pagespeed: { performance: 38, seo: 82 } };
const f = findings(bad);
assert.deepEqual(f.map(x => x.level), ['red', 'red', 'red', 'amber', 'amber', 'amber', 'amber', 'amber', 'amber', 'info', 'info', 'info'], 'worst first');
assert.equal(f[0].text, 'It tells Google not to list it (noindex)');
assert.match(f.find(x => /description is/.test(x.text)).text, /200 characters/);
assert.match(f.find(x => /speed score/.test(x.text)).text, /38\/100/);
assert.match(findings({ onpage: { ...good.onpage, titleLength: 75, title: 'x'.repeat(75) } })[0].text, /75 characters; Google shows about 60/);

// A site's month.
const site = { id: 1, status: 'active', domain: 'newforestlocksmith.com', client_name: 'ALS Locksmiths' };
const work = [{ done_on: '2026-10-03', what: 'Published a blog post', minutes: 90 }, { done_on: '2026-09-20', what: 'GBP posts', minutes: 30 }];
const s = siteState(site, { checks: [bad, good], work, fee: 500, today: '2026-10-19' });
assert.deepEqual([s.flags, s.work.length, s.minutes, s.lastWork.done_on, s.fee], [['problem'], 1, 90, '2026-10-03', 500]);
assert.deepEqual(siteState(site, { work: [work[1]], today: '2026-10-19' }).flags, ['unchecked', 'no-work'], `nothing logged by the ${WORK_BY_DAY}th`);
assert.deepEqual(siteState(site, { work: [], today: '2026-10-10' }).flags, ['unchecked'], 'early in the month: not yet');
assert.deepEqual(siteState({ ...site, status: 'setup' }, { today: '2026-10-19' }).flags, ['unchecked'], 'only active sites need monthly work');
assert.deepEqual(siteState(site, { checks: [{ ...good, pagespeed: { performance: 71, seo: 100 } }], work, today: '2026-10-19' }).scores, { performance: 71, seo: 100 });

// The fee from Xero: monthly lines that say SEO.
const rep = [{ contact_name: 'ALS Locksmiths', status: 'AUTHORISED', period: 1, line_items: [{ description: 'Monthly SEO Management for newforestlocksmith.com', line_amount: 250 }, { description: 'SEO Management for NFL', line_amount: 250 }] },
  { contact_name: 'ALS Locksmiths', status: 'AUTHORISED', period: 12, line_items: [{ description: 'Web Hosting - 1 year', line_amount: 199 }] },
  { contact_name: 'MSA Safety', status: 'AUTHORISED', period: 1, line_items: [{ description: 'Website Hosting & WordPress Maintenance', line_amount: 95 }] }];
const same = (a, b) => a.toLowerCase() === b.toLowerCase();
assert.equal(seoFee(rep, same, 'ALS Locksmiths'), 500);
assert.equal(seoFee(rep, same, 'MSA Safety'), 0);
assert.match(findings({ onpage: { ...good.onpage, https: false, httpsError: 'invalid peer certificate: NotValidForName' } })[0].text, /broken: browsers show “Not secure”/);
// Search Console: the last 28 days against the 28 before, ending at the newest day there is.
const dayRows = Array.from({ length: 60 }, (_, i) => { const d = new Date(Date.UTC(2026, 9, 17) - i * 86400000).toISOString().slice(0, 10);
  return { day: d, clicks: i < 28 ? 3 : 1, impressions: 100, position: i < 28 ? 8 : 12 }; });
const ss = searchSummary(dayRows, '2026-10-19');
assert.equal(ss.end, '2026-10-17');
assert.deepEqual(ss.now, { clicks: 84, impressions: 2800, ctr: 0.03, position: 8 });
assert.deepEqual([ss.before.clicks, ss.before.position], [28, 12]);
assert.equal(ss.series.length, 90);
assert.equal(ss.series[89], 3);
assert.equal(ss.stale, false);
assert.equal(searchSummary([], '2026-10-19'), null);
assert.equal(searchSummary(dayRows, '2026-11-01').stale, true, 'two weeks without new figures: say so');
assert.match(sparkline([0, 1, 4, 2]), /^<svg class="seo-spark"[^>]*><polyline points="0\.0,34\.0 /);
console.log('seo: ok');
