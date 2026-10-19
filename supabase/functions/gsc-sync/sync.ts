// The Search Console sync: for each SEO site found among the account's properties, clicks/impressions/CTR/position per day (last 90
// days) and the top 50 searches of the last 28 days. Design: docs/superpowers/specs/2026-10-20-search-console-design.md
import { sql } from '../_shared/xero.ts';
import { accessToken, propertyFor } from '../_shared/google.ts';

const API = 'https://www.googleapis.com/webmasters/v3';
const iso = (d: Date) => d.toISOString().slice(0, 10);
const ago = (n: number) => iso(new Date(Date.now() - n * 86400000));

async function query(token: string, property: string, body: unknown) {
  const res = await fetch(`${API}/sites/${encodeURIComponent(property)}/searchAnalytics/query`, {
    method: 'POST', headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' }, body: JSON.stringify(body) });
  const d = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`${property}: ${d?.error?.message || res.status}`);
  return (d.rows || []) as any[];
}

export async function syncSearch() {
  try {
    const token = await accessToken();
    const res = await fetch(`${API}/sites`, { headers: { authorization: `Bearer ${token}` } });
    const d = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(d?.error?.message || `Search Console ${res.status}`);
    const properties = (d.siteEntry || []).filter((s: any) => s.permissionLevel !== 'siteUnverifiedUser').map((s: any) => s.siteUrl as string);
    const sites = await sql`select id, domain from public.seo_sites where status <> 'paused'`;
    let matched = 0;
    const errors: string[] = [];
    for (const s of sites) {
      const property = propertyFor(s.domain, properties);
      if (!property) continue;
      matched++;
      try {
        const days = await query(token, property, { startDate: ago(92), endDate: ago(2), dimensions: ['date'], rowLimit: 500 });
        const rows = days.map(r => ({ site_id: s.id, day: r.keys[0], clicks: Math.round(r.clicks), impressions: Math.round(r.impressions), ctr: r.ctr, position: r.position }));
        if (rows.length) await sql`insert into public.seo_search_days ${sql(rows)} on conflict (site_id, day) do update set clicks = excluded.clicks,
          impressions = excluded.impressions, ctr = excluded.ctr, position = excluded.position`;
        const end = ago(2);
        const qs = await query(token, property, { startDate: ago(29), endDate: end, dimensions: ['query'], rowLimit: 50 });
        await sql`delete from public.seo_search_queries where site_id = ${s.id}`;
        const qrows = qs.map(r => ({ site_id: s.id, query: String(r.keys[0]).slice(0, 300), clicks: Math.round(r.clicks), impressions: Math.round(r.impressions), ctr: r.ctr, position: r.position, period_end: end }));
        if (qrows.length) await sql`insert into public.seo_search_queries ${sql(qrows)} on conflict (site_id, query) do nothing`;
      } catch (err) { errors.push(String((err as Error).message || err).slice(0, 160)); }
    }
    await sql`update public.google_status set connected = true, properties = ${sql.json(properties)}, last_sync_at = now(),
              last_sync_ok = ${errors.length === 0}, last_error = ${errors.join('; ').slice(0, 500)} where id = 1`;
    return { ok: errors.length === 0, sites: sites.length, matched, properties: properties.length, error: errors.join('; ') };
  } catch (err) {
    const message = String((err as Error).message || err).slice(0, 500);
    await sql`update public.google_status set last_sync_at = now(), last_sync_ok = false, last_error = ${message} where id = 1`;
    return { ok: false, sites: 0, matched: 0, error: message };
  }
}
