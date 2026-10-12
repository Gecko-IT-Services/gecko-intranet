// Pulls Atera's customers and devices (agents) into the database: four times a day from the scheduler (x-cron-secret)
// or on demand by staff (Monitoring › Devices › Refresh). Read only towards Atera: only GET requests are made.
// Secret: ATERA_API_KEY (Atera › Admin › API). Design: docs/superpowers/specs/2026-10-11-atera-devices-design.md
import { cors, json, sql, staffEmail } from '../_shared/xero.ts';

const API = 'https://app.atera.com/api/v3';

/** What kind of key was saved, without revealing it: a classic 32-character key, a token (JWT), or something else. */
const keyShape = (k: string) => (/^[0-9a-f]{32}$/i.test(k) ? 'a 32-character key' : /^eyJ[\w-]+\.[\w-]+\.[\w-]+$/.test(k) ? `a ${k.length}-character token (JWT)` : `${k.length} characters, not the usual 32-character key`);

// Atera's classic keys go in X-API-KEY; newer tokens may need Authorization: Bearer. Try the first, then the second.
const AUTH = [(k: string) => ({ 'X-API-KEY': k }), (k: string) => ({ Authorization: `Bearer ${k}` })];
let authStyle = 0;

async function getAll(path: string, key: string) {
  const out: any[] = [];
  for (let page = 1; page <= 200; page++) {
    const url = `${API}${path}?page=${page}&itemsInPage=50`;
    let res = await fetch(url, { headers: { ...AUTH[authStyle](key), accept: 'application/json' } });
    if ((res.status === 401 || res.status === 403) && authStyle === 0) {
      authStyle = 1;
      res = await fetch(url, { headers: { ...AUTH[authStyle](key), accept: 'application/json' } });
      if (res.status === 401 || res.status === 403) authStyle = 0;
    }
    if (res.status === 401 || res.status === 403) throw new Error(`Atera refused the API key (${res.status}; the saved key is ${keyShape(key)}). Copy it again from Atera › Admin › API and update ATERA_API_KEY in Supabase › Edge Functions › Secrets.`);
    if (!res.ok) throw new Error(`Atera ${path} ${res.status}: ${(await res.text()).slice(0, 200)}`);
    const body = await res.json();
    const items = (body?.items || body?.Items || []) as any[];
    out.push(...items);
    const total = Number(body?.totalPages ?? body?.TotalPages ?? 0);
    if (!items.length || (total && page >= total)) break;
  }
  return out;
}

const pick = (o: any, ...names: string[]) => { for (const n of names) if (o?.[n] != null && o[n] !== '') return o[n]; return null; };
const text = (v: unknown) => (v == null ? '' : String(v)).slice(0, 300);
const when = (v: unknown) => { if (!v) return null; const d = new Date(String(v)); return isNaN(d.getTime()) ? null : d.toISOString(); };
const LAST_SEEN = ['LastSeen', 'LastSeenDate', 'LastAvailable', 'LastOnline', 'LastAgentCheckIn', 'Modified'];

export async function syncAtera() {
  const key = (Deno.env.get('ATERA_API_KEY') || '').trim().replace(/^["']|["']$/g, '');   // pasted keys often carry a space, line break or quotes
  if (!key) throw new Error('ATERA_API_KEY is not set in Supabase › Edge Functions › Secrets');
  try {
    const customers = await getAll('/customers', key);
    const agents = await getAll('/agents', key);
    await sql.begin(async tx => {
      await tx`delete from public.atera_customers`;
      for (const c of customers) {
        const id = Number(pick(c, 'CustomerID', 'CustomerId', 'ID'));
        if (!id) continue;
        await tx`insert into public.atera_customers (customer_id, name, raw) values (${id}, ${text(pick(c, 'CustomerName', 'Name'))}, ${tx.json(c)})
                 on conflict (customer_id) do nothing`;
      }
      // Devices removed in Atera leave here too: the table is what Atera has now.
      await tx`delete from public.atera_agents`;
      for (const a of agents) {
        const id = Number(pick(a, 'AgentID', 'AgentId', 'ID'));
        if (!id) continue;
        const seenField = LAST_SEEN.find(n => when(a?.[n])) || '';
        await tx`insert into public.atera_agents (agent_id, customer_id, customer_name, machine_name, device_type, os, os_version, online,
                   last_seen, last_seen_field, last_user, vendor, model, serial, raw)
                 values (${id}, ${Number(pick(a, 'CustomerID', 'CustomerId')) || null}, ${text(pick(a, 'CustomerName'))},
                   ${text(pick(a, 'MachineName', 'AgentName', 'SystemName', 'ComputerName'))}, ${text(pick(a, 'OSType', 'DeviceType'))},
                   ${text(pick(a, 'OS', 'OperatingSystem', 'OSName'))}, ${text(pick(a, 'OSVersion', 'OSBuild'))},
                   ${typeof a?.Online === 'boolean' ? a.Online : (typeof a?.OnlineStatus === 'boolean' ? a.OnlineStatus : null)},
                   ${seenField ? when(a[seenField]) : null}, ${seenField},
                   ${text(pick(a, 'LastLoginUser', 'CurrentLoggedUsers', 'LastLoggedOnUser'))},
                   ${text(pick(a, 'Vendor', 'Manufacturer'))}, ${text(pick(a, 'VendorBrandModel', 'Model', 'ProductName'))},
                   ${text(pick(a, 'VendorSerialNumber', 'SerialNumber'))}, ${tx.json(a)})
                 on conflict (agent_id) do nothing`;
      }
      await tx`update public.atera_status set last_sync_at = now(), last_sync_ok = true, last_error = '',
               customers = ${customers.length}, agents = ${agents.length} where id = 1`;
    });
    return { ok: true, customers: customers.length, agents: agents.length, auth: authStyle ? 'bearer' : 'x-api-key' };
  } catch (err) {
    const message = String((err as Error).message || err).slice(0, 500);
    await sql`update public.atera_status set last_sync_at = now(), last_sync_ok = false, last_error = ${message} where id = 1`;
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
    return json(await syncAtera());
  } catch (err) {
    return json({ ok: false, error: String((err as Error).message || err) }, 500);
  }
});
