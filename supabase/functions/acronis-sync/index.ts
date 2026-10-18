// Pulls Acronis Cyber Protect Cloud into the database: customers, usage, machines and M365 resources, their backup status,
// agents, plans and alerts. Four times a day from the scheduler (x-cron-secret) or on demand by staff. Read only towards
// Acronis: the token requests and GETs, nothing else.
// Secrets: ACRONIS_CLIENT_ID, ACRONIS_CLIENT_SECRET, ACRONIS_BASE_URL. Design: docs/superpowers/specs/2026-10-18-acronis-sync-design.md
import { cors, json, sql, staffEmail } from '../_shared/xero.ts';

const clean = (v: string | undefined) => (v || '').trim().replace(/^["']|["']$/g, '');   // pasted values often carry a space or quotes

async function token(base: string, form: Record<string, string>, basic: string) {
  const res = await fetch(`${base}/api/2/idp/token`, {
    method: 'POST',
    headers: { authorization: basic, 'content-type': 'application/x-www-form-urlencoded', accept: 'application/json' },
    body: new URLSearchParams(form)
  });
  if (!res.ok) throw new Error(`Acronis token ${res.status}: ${(await res.text()).slice(0, 200)}`);
  return String((await res.json()).access_token || '');
}

async function get(base: string, path: string, bearer: string) {
  const res = await fetch(`${base}${path}`, { headers: { authorization: `Bearer ${bearer}`, accept: 'application/json' } });
  if (!res.ok) throw new Error(`${path.split('?')[0]} ${res.status}: ${(await res.text()).slice(0, 200)}`);
  return await res.json();
}

/** Every item from an endpoint that pages with `after` cursors (resource, agent, policy and alert APIs). */
async function getAll(base: string, path: string, bearer: string) {
  const out: any[] = [];
  let after = '';
  for (let page = 0; page < 40; page++) {
    const sep = path.includes('?') ? '&' : '?';
    const body = await get(base, `${path}${sep}limit=500${after ? `&after=${encodeURIComponent(after)}` : ''}`, bearer);
    const items = (Array.isArray(body) ? body : body?.items || []) as any[];
    out.push(...items);
    after = body?.paging?.cursors?.after || '';
    if (!after || !items.length) break;
  }
  return out;
}

const idOf = (o: any, i: number) => String(o?.id ?? o?.uuid ?? o?.resource_id ?? o?.context?.id ?? o?.policy?.id ?? i);

// Per customer, with a token scoped to that customer. Each fetch stands alone: one failing doesn't stop the rest.
const PER_CUSTOMER: [string, string][] = [
  ['resource', '/api/resource_management/v4/resources'],
  ['resource_status', '/api/resource_management/v4/resource_statuses'],
  ['agent', '/api/agent_manager/v2/agents'],
  ['policy', '/api/policy_management/v4/policies'],
  ['alert', '/api/alert_manager/v1/alerts']
];

export async function syncAcronis() {
  const base = clean(Deno.env.get('ACRONIS_BASE_URL')).replace(/\/+$/, '');
  const id = clean(Deno.env.get('ACRONIS_CLIENT_ID')), secret = clean(Deno.env.get('ACRONIS_CLIENT_SECRET'));
  try {
    if (!base || !id || !secret) throw new Error('ACRONIS_BASE_URL / ACRONIS_CLIENT_ID / ACRONIS_CLIENT_SECRET are not all set in Supabase › Edge Functions › Secrets');
    const basic = 'Basic ' + btoa(`${id}:${secret}`);
    const partner = await token(base, { grant_type: 'client_credentials' }, basic);
    const home = String((await get(base, `/api/2/clients/${id}`, partner))?.tenant_id || '');
    if (!home) throw new Error('Acronis did not say which tenant the API client belongs to');

    // Customers under Gecko, through any folders or sub-partners.
    const tenants: any[] = [];
    const queue = [home];
    for (let depth = 0; queue.length && depth < 200; depth++) {
      const parent = queue.shift()!;
      const body = await get(base, `/api/2/tenants?parent_id=${parent}`, partner);
      for (const t of body?.items || []) {
        tenants.push(t);
        if (t.kind !== 'customer' && t.kind !== 'unit') queue.push(t.id);
      }
    }
    const customers = tenants.filter(t => t.kind === 'customer');

    const rows: { kind: string; item_id: string; tenant_id: string; raw: unknown }[] = [];
    const replaced = new Set<string>();        // "tenant|kind" fetched in full, safe to replace
    const problems: { tenant: string; kind: string; error: string }[] = [];

    // Usage: one call for many customers.
    for (let i = 0; i < customers.length; i += 50) {
      const batch = customers.slice(i, i + 50);
      try {
        const body = await get(base, `/api/2/tenants/usages?tenants=${batch.map(t => t.id).join(',')}`, partner);
        for (const u of body?.items || []) {
          const tid = String(u.tenant || u.tenant_id || '');
          (u.usages || []).forEach((x: any, n: number) =>
            rows.push({ kind: 'usage', tenant_id: tid, item_id: `${tid}|${x.name}|${x.edition || ''}|${x.offering_item || ''}|${n}`, raw: x }));
        }
        batch.forEach(t => replaced.add(`${t.id}|usage`));
      } catch (err) {
        problems.push({ tenant: '(several)', kind: 'usage', error: String((err as Error).message).slice(0, 300) });
      }
    }

    for (const t of customers) {
      let scoped = '';
      try {
        scoped = await token(base, { grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion: partner, scope: `urn:acronis.com:tenant-id:${t.id}` }, basic);
      } catch (err) {
        problems.push({ tenant: t.name, kind: 'token', error: String((err as Error).message).slice(0, 300) });
        continue;
      }
      for (const [kind, path] of PER_CUSTOMER) {
        try {
          const items = await getAll(base, path, scoped);
          items.forEach((o, n) => rows.push({ kind, tenant_id: t.id, item_id: `${t.id}|${idOf(o, n)}`, raw: o }));
          replaced.add(`${t.id}|${kind}`);
        } catch (err) {
          problems.push({ tenant: t.name, kind, error: String((err as Error).message).slice(0, 300) });
        }
      }
    }

    const counts: Record<string, number> = {};
    rows.forEach(r => (counts[r.kind] = (counts[r.kind] || 0) + 1));
    await sql.begin(async tx => {
      await tx`delete from public.acronis_tenants`;
      for (const t of tenants) {
        await tx`insert into public.acronis_tenants (tenant_id, name, kind, parent_id, raw)
                 values (${String(t.id)}, ${String(t.name || '')}, ${String(t.kind || '')}, ${String(t.parent_id || '')}, ${tx.json(t)})
                 on conflict (tenant_id) do nothing`;
      }
      for (const key of replaced) {
        const [tid, kind] = key.split('|');
        await tx`delete from public.acronis_items where tenant_id = ${tid} and kind = ${kind}`;
      }
      for (const r of rows) {
        if (!replaced.has(`${r.tenant_id}|${r.kind}`)) continue;
        await tx`insert into public.acronis_items (kind, item_id, tenant_id, raw) values (${r.kind}, ${r.item_id}, ${r.tenant_id}, ${tx.json(r.raw as any)})
                 on conflict (kind, item_id) do update set raw = excluded.raw, synced_at = now()`;
      }
      await tx`update public.acronis_status set last_sync_at = now(), last_sync_ok = true, last_error = '',
               tenants = ${customers.length}, counts = ${tx.json(counts)}, problems = ${tx.json(problems)} where id = 1`;
    });
    return { ok: true, customers: customers.length, counts, problems };
  } catch (err) {
    const message = String((err as Error).message || err).slice(0, 500);
    await sql`update public.acronis_status set last_sync_at = now(), last_sync_ok = false, last_error = ${message} where id = 1`;
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
    return json(await syncAcronis());
  } catch (err) {
    return json({ ok: false, error: String((err as Error).message || err) }, 500);
  }
});
