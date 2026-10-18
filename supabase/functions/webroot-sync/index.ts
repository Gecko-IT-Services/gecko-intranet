// Pulls Webroot (OpenText) sites and endpoints into the database: four times a day from the scheduler (x-cron-secret) or on
// demand by staff. Read only towards Webroot: the token request and GETs, nothing else.
// Secrets: WEBROOT_CLIENT_ID, WEBROOT_CLIENT_SECRET, WEBROOT_USERNAME, WEBROOT_PASSWORD (a view-only console admin),
// WEBROOT_GSM_KEY (Parent Keycode). Design: docs/superpowers/specs/2026-10-18-atera-reconcile-design.md
import { cors, json, sql, staffEmail } from '../_shared/xero.ts';

const API = 'https://unityapi.webrootcloudav.com';
// Pasted values often carry spaces, quotes (straight or curly) or invisible characters from the page they were copied from.
const clean = (v: string | undefined) => (v || '').replace(/[\u200B-\u200D\u2060\uFEFF]/g, '').replace(/\u00A0/g, ' ').trim()
  .replace(/^["'\u2018\u2019\u201C\u201D]+|["'\u2018\u2019\u201C\u201D]+$/g, '').trim();
/** Names the secret (never its value) that still holds a character Webroot's sign-in can't take. */
const plain = (name: string, v: string) => {
  const odd = [...v].find(c => c.charCodeAt(0) > 126 || c.charCodeAt(0) < 32);
  if (odd) throw new Error(`${name} contains an unusual character (code ${odd.charCodeAt(0)}). Type it again by hand in Supabase › Edge Functions › Secrets.`);
  return v;
};

async function token() {
  const id = clean(Deno.env.get('WEBROOT_CLIENT_ID')), secret = clean(Deno.env.get('WEBROOT_CLIENT_SECRET'));
  const username = clean(Deno.env.get('WEBROOT_USERNAME')), password = clean(Deno.env.get('WEBROOT_PASSWORD'));
  const missing = [['WEBROOT_CLIENT_ID', id], ['WEBROOT_CLIENT_SECRET', secret], ['WEBROOT_USERNAME', username], ['WEBROOT_PASSWORD', password]]
    .filter(([, v]) => !v).map(([n]) => n);
  if (missing.length) throw new Error(`Not set in Supabase › Edge Functions › Secrets: ${missing.join(', ')}`);
  plain('WEBROOT_CLIENT_ID', id); plain('WEBROOT_CLIENT_SECRET', secret);
  const res = await fetch(`${API}/auth/token`, {
    method: 'POST',
    headers: { authorization: 'Basic ' + btoa(`${id}:${secret}`), 'content-type': 'application/x-www-form-urlencoded', accept: 'application/json' },
    body: new URLSearchParams({ grant_type: 'password', username, password, scope: '*' })
  });
  if (!res.ok) throw new Error(`Webroot sign-in ${res.status}: ${(await res.text()).slice(0, 200)}`);
  return String((await res.json()).access_token || '');
}

async function get(path: string, bearer: string) {
  const res = await fetch(`${API}${path}`, { headers: { authorization: `Bearer ${bearer}`, accept: 'application/json' } });
  if (!res.ok) throw new Error(`${path.split('?')[0].replace(/gsm\/[^/]+/, 'gsm/…')} ${res.status}: ${(await res.text()).slice(0, 200)}`);
  return await res.json();
}

export async function syncWebroot() {
  try {
    const gsm = clean(Deno.env.get('WEBROOT_GSM_KEY'));
    if (!gsm) throw new Error('Not set in Supabase › Edge Functions › Secrets: WEBROOT_GSM_KEY');
    const bearer = await token();
    const base = `/service/api/console/gsm/${encodeURIComponent(gsm)}`;
    const sites = ((await get(`${base}/sites`, bearer))?.Sites || []) as any[];
    console.log(`webroot: ${sites.length} sites`);
    const endpoints: { endpoint_id: string; site_id: string; hostname: string; raw: unknown }[] = [];
    const done = new Set<string>();
    const problems: { site: string; error: string }[] = [];
    for (const s of sites) {
      const siteId = String(s.SiteId || '');
      if (!siteId) continue;
      try {
        for (let page = 1; page <= 20; page++) {
          const body = await get(`${base}/sites/${encodeURIComponent(siteId)}/endpoints?pageSize=1000&pageNr=${page}`, bearer);
          const list = (body?.Endpoints || []) as any[];
          for (const e of list) endpoints.push({ endpoint_id: String(e.EndpointId || `${siteId}|${e.HostName}`), site_id: siteId, hostname: String(e.HostName || ''), raw: e });
          if (list.length < 1000) break;
        }
        done.add(siteId);
      } catch (err) {
        problems.push({ site: String(s.SiteName || siteId), error: String((err as Error).message).slice(0, 300) });
      }
    }
    // Saved in batches: the free plan allows ~2 s of CPU per run.
    const siteRows = sites.filter(s => s.SiteId).map(s => ({ site_id: String(s.SiteId), name: String(s.SiteName || ''), raw: s }));
    const keep = endpoints.filter(e => done.has(e.site_id));
    await sql.begin(async tx => {
      await tx`delete from public.webroot_sites`;
      await tx`insert into public.webroot_sites (site_id, name, raw)
               select site_id, name, raw from jsonb_to_recordset(${tx.json(siteRows as any)}) as x(site_id text, name text, raw jsonb)
               on conflict (site_id) do nothing`;
      await tx`delete from public.webroot_endpoints where site_id = any(${[...done]}) or site_id <> all(${siteRows.map(s => s.site_id)})`;
      for (let i = 0; i < keep.length; i += 500) {
        await tx`insert into public.webroot_endpoints (endpoint_id, site_id, hostname, raw)
                 select endpoint_id, site_id, hostname, raw from jsonb_to_recordset(${tx.json(keep.slice(i, i + 500) as any)})
                   as x(endpoint_id text, site_id text, hostname text, raw jsonb)
                 on conflict (endpoint_id) do update set site_id = excluded.site_id, hostname = excluded.hostname, raw = excluded.raw, synced_at = now()`;
      }
      await tx`update public.webroot_status set last_sync_at = now(), last_sync_ok = true, last_error = '',
               sites = ${siteRows.length}, endpoints = ${keep.length}, problems = ${tx.json(problems)} where id = 1`;
    });
    return { ok: true, sites: siteRows.length, endpoints: keep.length, problems };
  } catch (err) {
    const message = String((err as Error).message || err).slice(0, 500);
    await sql`update public.webroot_status set last_sync_at = now(), last_sync_ok = false, last_error = ${message} where id = 1`;
    return { ok: false, error: message };
  }
}

Deno.serve(async req => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  try {
    const given = req.headers.get('x-cron-secret');
    let allowed = false;
    if (given) {
      const [row] = await sql`select secret from private.cron_secret where id = 1`;
      allowed = !!row && row.secret === given;
    } else {
      allowed = !!(await staffEmail(req));
    }
    if (!allowed) return json({ error: 'Not allowed' }, 403);
    return json(await syncWebroot());
  } catch (err) {
    return json({ ok: false, error: String((err as Error).message || err) }, 500);
  }
});
