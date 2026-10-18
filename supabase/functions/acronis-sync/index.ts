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

/**
 * Microsoft 365 users per customer, from the backup console's API (the one Acronis's own console uses; not in the public
 * docs, found 18 Oct 2026): root c2c group → organisation → Users → All users → resources. Each user says whether Acronis
 * charges a seat for it (licenseOfferingItems has pw_base_m365_seats). Kept small: who, and what makes them count.
 */
async function m365Users(base: string, bearer: string) {
  const rm = `${base}/bc/api/resource_manager/v1`;
  const data = (b: any) => (Array.isArray(b) ? b : b?.data || b?.items || []) as any[];
  const out: any[] = [];
  const roots = data(await get('', `${rm}/groups/c2c?parentId=0`, bearer)).filter(r => (r.resource_types || []).some((t: string) => /o365/.test(t)));
  for (const root of roots) {
    for (const org of data(await get('', `${rm}/o365/groups?parentId=${root.id}&limit=500`, bearer))) {
      const usersGroup = data(await get('', `${rm}/o365/groups?parentId=${org.id}&limit=500`, bearer)).find(g => g.groupKind === 'c2cUsersGroup');
      if (!usersGroup) continue;
      const all = data(await get('', `${rm}/o365/groups?parentId=${usersGroup.id}&limit=500`, bearer)).find(g => g.groupKind === 'c2cUsers');
      if (!all) continue;
      for (const u of data(await get('', `${rm}/o365/groups/${all.id}/resources?limit=500`, bearer))) {
        out.push({ id: u.id, org: org.name, name: u.title || u.name || '', email: u.email || '', licensedByMsft: !!u.licensedByMsft,
          seat: (u.licenseOfferingItems || []).includes('pw_base_m365_seats'), offering: u.licenseOfferingItems || [], blocked: !!u.signInBlocked,
          recipientType: u.recipientType || '', isAdmin: !!u.isAdmin, protected: !!u.hasProtections });
      }
    }
  }
  return out;
}

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
    console.log(`acronis: ${tenants.length} tenants, ${customers.length} customers`);

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
      try {
        const users = await m365Users(base, scoped);
        users.forEach(u => rows.push({ kind: 'm365_user', tenant_id: t.id, item_id: `${t.id}|${u.id}`, raw: u }));
        replaced.add(`${t.id}|m365_user`);
      } catch (err) {
        problems.push({ tenant: t.name, kind: 'm365_user', error: String((err as Error).message).slice(0, 300) });
      }
      for (const [kind, path] of PER_CUSTOMER) {
        try {
          const items = await getAll(base, path, scoped);
          items.forEach((o, n) => rows.push({ kind, tenant_id: t.id, item_id: `${t.id}|${idOf(o, n)}`, raw: o }));
          replaced.add(`${t.id}|${kind}`);
          console.log(`acronis: ${t.name} ${kind} ${items.length}`);
        } catch (err) {
          problems.push({ tenant: t.name, kind, error: String((err as Error).message).slice(0, 300) });
        }
      }
    }

    // Saved in batches (one statement per 500 rows, not one per row): the free plan allows ~2 s of CPU per run.
    const keep = new Map<string, (typeof rows)[number]>();
    for (const r of rows) if (replaced.has(`${r.tenant_id}|${r.kind}`)) keep.set(`${r.kind}|${r.item_id}`, r);
    const saving = [...keep.values()];
    const counts: Record<string, number> = {};
    saving.forEach(r => (counts[r.kind] = (counts[r.kind] || 0) + 1));
    const pairs = [...replaced].map(k => { const [tenant_id, kind] = k.split('|'); return { tenant_id, kind }; });
    const tenantRows = tenants.map(t => ({ tenant_id: String(t.id), name: String(t.name || ''), kind: String(t.kind || ''), parent_id: String(t.parent_id || ''), raw: t }));
    await sql.begin(async tx => {
      await tx`delete from public.acronis_tenants`;
      await tx`insert into public.acronis_tenants (tenant_id, name, kind, parent_id, raw)
               select tenant_id, name, kind, parent_id, raw from jsonb_to_recordset(${tx.json(tenantRows as any)})
                 as x(tenant_id text, name text, kind text, parent_id text, raw jsonb)
               on conflict (tenant_id) do nothing`;
      await tx`delete from public.acronis_items i using jsonb_to_recordset(${tx.json(pairs as any)}) as x(tenant_id text, kind text)
               where i.tenant_id = x.tenant_id and i.kind = x.kind`;
      for (let i = 0; i < saving.length; i += 500) {
        await tx`insert into public.acronis_items (kind, item_id, tenant_id, raw)
                 select kind, item_id, tenant_id, raw from jsonb_to_recordset(${tx.json(saving.slice(i, i + 500) as any)})
                   as x(kind text, item_id text, tenant_id text, raw jsonb)
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
