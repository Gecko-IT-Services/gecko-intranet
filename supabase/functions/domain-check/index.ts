// When each client domain expires (Philip, 19 Oct 2026: "yes build the dates next"). Finds the domains Gecko knows of (Xero repeating
// lines that name one, client contacts' email addresses, websites on client pages), asks the public registry (RDAP, no key: Nominet
// for .uk, rdap.org for the rest) and keeps the expiry date in public.domain_dates. Weekly (Mondays) and on demand by staff.
// Read only towards everyone. Design: docs/superpowers/specs/2026-10-19-dates-come-round-design.md
import { cors, json, sql, staffEmail } from '../_shared/xero.ts';

// Free and shared mail services: a contact's address there says nothing about the client's own domain.
const FREE = /^(gmail|googlemail|outlook|hotmail|live|msn|yahoo|icloud|me|aol|btinternet|btopenworld|sky|talktalk|virginmedia|ntlworld|protonmail|proton|gmx|mail|zoho|blueyonder|tiscali|plus)\.(com|co\.uk|net|me|uk)$/i;
const DOMAIN = /\b((?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+(?:co\.uk|org\.uk|me\.uk|uk\.com|uk|com|net|org|io|co|biz|info))\b/i;

/** The domain in a line of text, an email address or a URL, lower case without "www." (or ''). */
export function domainOf(text: string) {
  const t = String(text || '').toLowerCase().replace(/^https?:\/\//, '').replace(/^.*@/, '');
  const m = t.match(DOMAIN);
  return m ? m[1].replace(/^www\./, '') : '';
}

const wait = (ms: number) => new Promise(r => setTimeout(r, ms));

async function rdap(domain: string) {
  const url = /\.uk$/.test(domain) && !/\.uk\.com$/.test(domain) ? `https://rdap.nominet.uk/uk/domain/${domain}` : `https://rdap.org/domain/${domain}`;
  // The registries limit how fast they're asked (Nominet answered 429 on the first run, 19 Oct 2026): pause, and retry when told to.
  let res = await fetch(url, { headers: { accept: 'application/rdap+json' }, redirect: 'follow' });
  for (let i = 0; res.status === 429 && i < 3; i++) { await wait(4000 * (i + 1)); res = await fetch(url, { headers: { accept: 'application/rdap+json' }, redirect: 'follow' }); }
  if (res.status === 404) return { error: 'not found in the registry' };
  if (!res.ok) return { error: `registry said ${res.status}` };
  const body = await res.json();
  const exp = (body.events || []).find((e: any) => /expiration/i.test(e.eventAction || ''))?.eventDate || null;
  const reg = (body.entities || []).find((e: any) => (e.roles || []).includes('registrar'));
  const name = reg?.vcardArray?.[1]?.find((v: any) => v[0] === 'fn')?.[3] || reg?.handle || '';
  return { expires: exp ? String(exp).slice(0, 10) : null, registrar: String(name).slice(0, 120), error: exp ? '' : 'no expiry date published' };
}

export async function check() {
  const found = new Map<string, { client: string; sources: Set<string>; billed: boolean }>();
  const note = (d: string, client: string, source: string, billed = false) => {
    if (!d || FREE.test(d) || /gecko-it\.com$/.test(d)) return;
    const e = found.get(d) || { client, sources: new Set<string>(), billed: false };
    e.sources.add(source); e.billed = e.billed || billed; if (!e.client) e.client = client;
    found.set(d, e);
  };
  const hosted = new Set<string>();   // clients we invoice hosting to, whether or not the line names the domain
  for (const r of await sql`select contact_name, line_items from public.xero_repeating_invoices where status = 'AUTHORISED'`)
    for (const l of (r.line_items || [])) if (/domain|hosting/i.test(l.description || '')) {
      hosted.add(String(r.contact_name).toLowerCase());
      note(domainOf(l.description), r.contact_name, 'xero', /domain/i.test(l.description || ''));
    }
  for (const c of await sql`select client_name, email from public.client_contacts where email <> ''`) note(domainOf(c.email), c.client_name, 'email');
  for (const p of await sql`select client_name, website from public.client_profiles where website <> ''`) note(domainOf(p.website), p.client_name, 'website');
  for (const e of found.values()) if (hosted.has(String(e.client).toLowerCase())) e.sources.add('hosting');
  let n = 0;
  for (const [domain, e] of found) {
    let r: any;
    try { r = await rdap(domain); } catch (err) { r = { error: String((err as Error).message || err).slice(0, 200) }; }
    await wait(1200);
    await sql`insert into public.domain_dates (domain, client_name, sources, billed, expires_on, registrar, error, checked_at)
              values (${domain}, ${e.client}, ${[...e.sources]}, ${e.billed}, ${r.expires || null}, ${r.registrar || ''}, ${r.error || ''}, now())
              on conflict (domain) do update set client_name = excluded.client_name, sources = excluded.sources, billed = excluded.billed,
                expires_on = coalesce(excluded.expires_on, domain_dates.expires_on), registrar = excluded.registrar, error = excluded.error, checked_at = now()`;
    n++;
  }
  await sql`update public.domain_status set last_sync_at = now(), last_sync_ok = true, last_error = '', domains = ${n} where id = 1`;
  return { ok: true, domains: n };
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
    return json(await check());
  } catch (err) {
    const message = String((err as Error).message || err).slice(0, 500);
    await sql`update public.domain_status set last_sync_at = now(), last_sync_ok = false, last_error = ${message} where id = 1`.catch(() => {});
    return json({ ok: false, error: message }, 500);
  }
});
