// A health check of each SEO site (Philip, 19 Oct 2026: "we need to stay on top of it"). Reads the home page as Google would (title,
// description, headings, indexing, canonical, business details, image descriptions, mobile set-up, Rank Math), robots.txt and the
// sitemap, and — when the secret PAGESPEED_API_KEY is set — Google PageSpeed's mobile scores and Core Web Vitals. One row per site in
// public.seo_checks. Weekly (Mondays) and on demand by staff ({ site_id } for one). Read only towards the sites.
// Design: docs/superpowers/specs/2026-10-20-seo-design.md
import { cors, json, sql, staffEmail } from '../_shared/xero.ts';

const UA = 'Mozilla/5.0 (compatible; GeckoHQ-SEO-check/1.0; +https://gecko-it.com)';
const pick = (html: string, re: RegExp) => { const m = html.match(re); return m ? m[1].replace(/\s+/g, ' ').trim() : ''; };
const decode = (s: string) => s.replace(/&amp;/g, '&').replace(/&#0?39;|&apos;/g, "'").replace(/&quot;/g, '"').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&nbsp;/g, ' ');
const meta = (html: string, name: string) => decode(pick(html, new RegExp(`<meta[^>]+(?:name|property)=["']${name}["'][^>]*content=["']([^"']*)["']`, 'i'))
  || pick(html, new RegExp(`<meta[^>]+content=["']([^"']*)["'][^>]*(?:name|property)=["']${name}["']`, 'i')));

async function get(url: string, ms = 20000) {
  const t0 = Date.now();
  const res = await fetch(url, { headers: { 'user-agent': UA, accept: 'text/html,*/*' }, redirect: 'follow', signal: AbortSignal.timeout(ms) });
  const text = await res.text();
  return { res, text, ms: Date.now() - t0 };
}

export async function onpage(domain: string) {
  const { res, text: html, ms } = await get(`https://${domain}/`);
  const finalUrl = res.url;
  const schema = [...html.matchAll(/<script[^>]+application\/ld\+json[^>]*>([\s\S]*?)<\/script>/gi)].flatMap(m => {
    try { const j = JSON.parse(m[1]); const all = [j, ...(Array.isArray(j) ? j : []), ...(j['@graph'] || [])]; return all.map((x: any) => x?.['@type']).flat().filter(Boolean); } catch { return []; }
  });
  const imgs = [...html.matchAll(/<img\b[^>]*>/gi)].map(m => m[0]);
  const h1 = [...html.matchAll(/<h1\b[^>]*>([\s\S]*?)<\/h1>/gi)].map(m => decode(m[1].replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim())).filter(Boolean);
  const origin = new URL(finalUrl).origin;
  let robotsTxt = '', robotsOk = false;
  try { const r = await get(`${origin}/robots.txt`, 10000); robotsOk = r.res.ok && !/<html/i.test(r.text); robotsTxt = robotsOk ? r.text.slice(0, 4000) : ''; } catch { /* none */ }
  const sitemapLine = pick(robotsTxt, /^\s*sitemap:\s*(\S+)/im);
  let sitemap = '';
  for (const u of [sitemapLine, `${origin}/sitemap_index.xml`, `${origin}/sitemap.xml`].filter(Boolean)) {
    try { const r = await get(u, 10000); if (r.res.ok && /<(urlset|sitemapindex)/i.test(r.text)) { sitemap = u; break; } } catch { /* next */ }
  }
  const robotsMeta = meta(html, 'robots');
  const title = decode(pick(html, /<title[^>]*>([\s\S]*?)<\/title>/i));
  const description = meta(html, 'description');
  return {
    url: `https://${domain}/`, finalUrl, status: res.status, https: finalUrl.startsWith('https://'), ms, bytes: html.length,
    title, titleLength: title.length, description, descriptionLength: description.length, h1,
    canonical: pick(html, /<link[^>]+rel=["']canonical["'][^>]*href=["']([^"']+)["']/i), noindex: /noindex/i.test(robotsMeta),
    viewport: /<meta[^>]+name=["']viewport["']/i.test(html), lang: pick(html, /<html[^>]*\blang=["']([^"']+)["']/i),
    ogTitle: meta(html, 'og:title'), schemaTypes: [...new Set(schema.map(String))].slice(0, 20),
    images: imgs.length, imagesNoAlt: imgs.filter(i => !/\balt=["'][^"']+["']/i.test(i)).length,
    robotsTxt: robotsOk, robotsBlocksAll: /^\s*user-agent:\s*\*\s*$[\s\S]*?^\s*disallow:\s*\/\s*$/im.test(robotsTxt), sitemap,
    rankMath: /rank-math|rank math/i.test(html), wordpress: /wp-content|wp-includes/i.test(html)
  };
}

async function pagespeed(domain: string) {
  const key = (Deno.env.get('PAGESPEED_API_KEY') || '').trim();
  if (!key) return null;
  const q = new URLSearchParams({ url: `https://${domain}/`, strategy: 'mobile', key });
  for (const c of ['PERFORMANCE', 'SEO', 'ACCESSIBILITY', 'BEST_PRACTICES']) q.append('category', c);
  const res = await fetch(`https://www.googleapis.com/pagespeedonline/v5/runPagespeed?${q}`, { signal: AbortSignal.timeout(90000) });
  const d = await res.json().catch(() => ({}));
  if (!res.ok) return { error: String(d?.error?.message || res.status).slice(0, 200) };
  const c = d.lighthouseResult?.categories || {};
  const score = (k: string) => (c[k]?.score == null ? null : Math.round(c[k].score * 100));
  const field = d.loadingExperience?.metrics || {};
  const fv = (k: string) => (field[k] ? { value: field[k].percentile, rating: field[k].category } : null);
  return { performance: score('performance'), seo: score('seo'), accessibility: score('accessibility'), bestPractices: score('best-practices'),
    lcp: fv('LARGEST_CONTENTFUL_PAINT_MS'), cls: fv('CUMULATIVE_LAYOUT_SHIFT_SCORE'), inp: fv('INTERACTION_TO_NEXT_PAINT') };
}

async function checkSite(s: any) {
  let page: any = {}, speed: any = null, error = '';
  try { page = await onpage(s.domain); } catch (err) { error = `The site didn't load: ${String((err as Error).message || err).slice(0, 160)}`; }
  try { speed = await pagespeed(s.domain); } catch (err) { speed = { error: String((err as Error).message || err).slice(0, 160) }; }
  await sql`insert into public.seo_checks (site_id, onpage, pagespeed, error) values (${s.id}, ${sql.json(page)}, ${speed ? sql.json(speed) : null}, ${error})`;
  return { domain: s.domain, ok: !error };
}

Deno.serve(async req => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  try {
    const given = req.headers.get('x-cron-secret');
    let allowed = false;
    if (given) {
      const [row] = await sql`select secret from private.cron_secret where id = 1`;
      allowed = !!row && row.secret === given;
    } else allowed = !!(await staffEmail(req));
    if (!allowed) return json({ error: 'Not allowed' }, 403);
    const input = await req.json().catch(() => ({}));
    const list = input.site_id ? await sql`select id, domain from public.seo_sites where id = ${Number(input.site_id)}`
      : await sql`select id, domain from public.seo_sites where status <> 'paused' order by id`;
    const done = [];
    for (const s of list) done.push(await checkSite(s));
    return json({ ok: true, checked: done, pagespeed: !!Deno.env.get('PAGESPEED_API_KEY') });
  } catch (err) {
    return json({ ok: false, error: String((err as Error).message || err).slice(0, 400) }, 500);
  }
});
