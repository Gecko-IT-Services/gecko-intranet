// Shared by the xero-* Edge Functions. Runs on Supabase, never in the browser.
// Design: docs/superpowers/specs/2026-10-08-xero-integration-design.md
//
// Secrets (Supabase › Edge Functions › Secrets): XERO_CLIENT_ID, XERO_CLIENT_SECRET,
// optional XERO_SCOPES. Supabase provides SUPABASE_DB_URL, SUPABASE_URL, SUPABASE_ANON_KEY.

import postgres from 'npm:postgres@3.4.4';

export const SITE_URL = 'https://gecko-it-services.github.io/gecko-intranet/';
export const REDIRECT_URI = 'https://nkobrqzsogtyxriqqwnq.supabase.co/functions/v1/xero-callback';
// Read-only: sales invoices and repeating invoices (the granular scope new Xero apps must use
// from 2 March 2026), plus offline_access for a refresh token. Overridable without a deploy.
export const SCOPES = Deno.env.get('XERO_SCOPES') || 'offline_access accounting.invoices.read';

const IDENTITY = 'https://identity.xero.com/connect/token';
const API = 'https://api.xero.com/api.xro/2.0';

export const sql = postgres(Deno.env.get('SUPABASE_DB_URL')!, { prepare: false, max: 2 });

export const cors = {
  'Access-Control-Allow-Origin': 'https://gecko-it-services.github.io',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS'
};
export const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, 'content-type': 'application/json' } });

function clientCreds() {
  const id = Deno.env.get('XERO_CLIENT_ID'), secret = Deno.env.get('XERO_CLIENT_SECRET');
  if (!id || !secret) throw new Error('XERO_CLIENT_ID / XERO_CLIENT_SECRET are not set in Supabase › Edge Functions › Secrets');
  return { id, secret, basic: 'Basic ' + btoa(`${id}:${secret}`) };
}

/**
 * The site's publishable key (it is in the page source anyway). The project uses the new API
 * keys, so the legacy SUPABASE_ANON_KEY Supabase provides is refused ("Invalid API key"):
 * the caller's own key (sent by supabase-js) comes first, then this one.
 */
const PUBLISHABLE_KEY = 'sb_publishable_9-Krnct-4TD9Ri_ci7Bgpw_tNV0lOrB';

/** Is the caller (by their Supabase session token) Gecko staff? → their email, or null. */
export async function staffEmail(req: Request): Promise<string | null> {
  const auth = req.headers.get('authorization') || '';
  if (!auth.startsWith('Bearer ')) { console.error('staff check: no session token'); return null; }
  const keys = [...new Set([req.headers.get('apikey'), PUBLISHABLE_KEY, Deno.env.get('SUPABASE_ANON_KEY')].filter(Boolean))] as string[];
  for (const apikey of keys) {
    const user = await fetch(`${Deno.env.get('SUPABASE_URL')}/auth/v1/user`, { headers: { authorization: auth, apikey } });
    if (!user.ok) { console.error(`staff check: auth/v1/user ${user.status} with key ${apikey.slice(0, 14)}…`); continue; }
    const email = String((await user.json())?.email || '').toLowerCase();
    if (!email) return null;
    const [row] = await sql`select 1 from public.staff where email = ${email}`;
    if (!row) console.error(`staff check: ${email} is not in public.staff`);
    return row ? email : null;
  }
  return null;
}

export function authorizeUrl(state: string) {
  const { id } = clientCreds();
  const p = new URLSearchParams({ response_type: 'code', client_id: id, redirect_uri: REDIRECT_URI, scope: SCOPES, state });
  return `https://login.xero.com/identity/connect/authorize?${p}`;
}

async function tokenRequest(form: Record<string, string>) {
  const { basic } = clientCreds();
  const res = await fetch(IDENTITY, {
    method: 'POST', headers: { authorization: basic, 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(form)
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`Xero token ${res.status}: ${body.error || ''} ${body.error_description || ''}`.trim());
  return body as { access_token: string; refresh_token: string; expires_in: number; scope?: string };
}

/**
 * Which of the organisations shared with the app to use. Gecko has two in Xero: the old
 * "Gecko IT" (to May 2026) and the Ltd, "Gecko IT Services" (from June 2026). The Ltd is
 * the one that trades now. An XERO_ORGANISATION secret (exact name) overrides the choice.
 */
export function pickOrganisation<T extends { tenantName: string }>(orgs: T[], wanted = Deno.env.get('XERO_ORGANISATION') || '') {
  const name = (o: T) => o.tenantName.toLowerCase();
  if (wanted) return orgs.find(o => name(o) === wanted.toLowerCase()) || null;
  return orgs.find(o => /gecko/.test(name(o)) && /services|ltd|limited/.test(name(o)))
    || orgs.find(o => /gecko/.test(name(o))) || orgs[0] || null;
}

/** Code from the consent screen → tokens + the organisation, stored. */
export async function connect(code: string, email: string) {
  const t = await tokenRequest({ grant_type: 'authorization_code', code, redirect_uri: REDIRECT_URI });
  const conns = await fetch('https://api.xero.com/connections', { headers: { authorization: `Bearer ${t.access_token}` } });
  if (!conns.ok) throw new Error(`Xero connections ${conns.status}`);
  const orgs = ((await conns.json()) as { tenantId: string; tenantName: string; tenantType: string }[])
    .filter(c => c.tenantType === 'ORGANISATION');
  const org = pickOrganisation(orgs);
  if (!org) throw new Error('No Xero organisation was shared with the app');
  // Switching organisation: the other one's invoices must not mix in, and the next sync is a full one.
  const [prev] = await sql`select tenant_id from private.xero_tokens where id = 1`;
  if (!prev || prev.tenant_id !== org.tenantId) {
    await sql`delete from public.xero_invoices`;
    await sql`delete from public.xero_repeating_invoices`;
    await sql`update public.xero_status set last_sync_at = null, last_sync_ok = null, invoices = 0, repeating = 0 where id = 1`;
  }
  const expires = new Date(Date.now() + (t.expires_in - 60) * 1000);
  await sql`insert into private.xero_tokens (id, tenant_id, tenant_name, refresh_token, access_token, access_expires, scopes, connected_by, connected_at)
            values (1, ${org.tenantId}, ${org.tenantName}, ${t.refresh_token}, ${t.access_token}, ${expires}, ${t.scope || SCOPES}, ${email}, now())
            on conflict (id) do update set tenant_id = excluded.tenant_id, tenant_name = excluded.tenant_name,
              refresh_token = excluded.refresh_token, access_token = excluded.access_token, access_expires = excluded.access_expires,
              scopes = excluded.scopes, connected_by = excluded.connected_by, connected_at = now()`;
  await sql`update public.xero_status set connected = true, tenant_name = ${org.tenantName}, connected_by = ${email},
            connected_at = now(), last_error = '', modified_at = now() where id = 1`;
  return org.tenantName;
}

/** A valid access token. Xero refresh tokens rotate: the new one is saved before anything else. */
async function accessToken() {
  const [row] = await sql`select * from private.xero_tokens where id = 1`;
  if (!row) throw new Error('Xero is not connected');
  if (row.access_token && row.access_expires && new Date(row.access_expires) > new Date(Date.now() + 60000)) {
    return { token: row.access_token as string, tenant: row.tenant_id as string };
  }
  const t = await tokenRequest({ grant_type: 'refresh_token', refresh_token: row.refresh_token });
  const expires = new Date(Date.now() + (t.expires_in - 60) * 1000);
  await sql`update private.xero_tokens set refresh_token = ${t.refresh_token}, access_token = ${t.access_token},
            access_expires = ${expires} where id = 1`;
  return { token: t.access_token, tenant: row.tenant_id as string };
}

async function xeroGet(path: string, auth: { token: string; tenant: string }, since?: Date) {
  const headers: Record<string, string> = { authorization: `Bearer ${auth.token}`, 'xero-tenant-id': auth.tenant, accept: 'application/json' };
  if (since) headers['if-modified-since'] = since.toUTCString();
  const res = await fetch(`${API}${path}`, { headers });
  if (res.status === 304) return null;
  if (!res.ok) throw new Error(`Xero ${path.split('?')[0]} ${res.status}: ${(await res.text()).slice(0, 200)}`);
  return res.json();
}

/** Xero dates: "2026-10-02T00:00:00" (…String fields) or "/Date(1759363200000+0000)/". */
export function xeroDate(v: unknown): string | null {
  if (!v) return null;
  const s = String(v);
  const ms = s.match(/\/Date\((-?\d+)/);
  const d = ms ? new Date(Number(ms[1])) : new Date(s.length === 19 ? s + 'Z' : s);
  return isNaN(d.getTime()) ? null : d.toISOString().slice(0, 10);
}

const lines = (li: any[] = []) => li.map(l => ({
  description: l.Description || '', quantity: l.Quantity ?? null, unit_amount: l.UnitAmount ?? null,
  line_amount: l.LineAmount ?? null, item_code: l.ItemCode || '', account_code: l.AccountCode || ''
}));

/**
 * Pull sales invoices (changed since the last good sync, all of them the first time) and
 * every repeating invoice, and record the result. Calls: 1 token refresh at most, 1 per
 * 100 invoices, 1 for repeating invoices; well inside Xero's daily limit when run hourly.
 */
export async function sync() {
  const [status] = await sql`select last_sync_at, last_sync_ok from public.xero_status where id = 1`;
  const since = status?.last_sync_ok && status.last_sync_at ? new Date(new Date(status.last_sync_at).getTime() - 3600000) : undefined;
  try {
    const auth = await accessToken();
    let invoices = 0;
    for (let page = 1; page < 200; page++) {
      const body = await xeroGet(`/Invoices?where=${encodeURIComponent('Type=="ACCREC"')}&page=${page}`, auth, since);
      const list = (body?.Invoices || []) as any[];
      for (const i of list) {
        await sql`insert into public.xero_invoices (invoice_id, invoice_number, contact_id, contact_name, invoice_date, due_date, status,
                    reference, sub_total, total_tax, total, amount_due, amount_paid, currency, repeating_invoice_id, line_items, updated_utc, synced_at)
                  values (${i.InvoiceID}, ${i.InvoiceNumber || ''}, ${i.Contact?.ContactID || ''}, ${i.Contact?.Name || ''},
                    ${xeroDate(i.DateString || i.Date)}, ${xeroDate(i.DueDateString || i.DueDate)}, ${i.Status || ''}, ${i.Reference || ''},
                    ${i.SubTotal ?? 0}, ${i.TotalTax ?? 0}, ${i.Total ?? 0}, ${i.AmountDue ?? 0}, ${i.AmountPaid ?? 0},
                    ${i.CurrencyCode || 'GBP'}, ${i.RepeatingInvoiceID || ''}, ${sql.json(lines(i.LineItems))},
                    ${i.UpdatedDateUTC ? new Date(Number(String(i.UpdatedDateUTC).match(/\d+/)?.[0])) : null}, now())
                  on conflict (invoice_id) do update set invoice_number = excluded.invoice_number, contact_id = excluded.contact_id,
                    contact_name = excluded.contact_name, invoice_date = excluded.invoice_date, due_date = excluded.due_date,
                    status = excluded.status, reference = excluded.reference, sub_total = excluded.sub_total, total_tax = excluded.total_tax,
                    total = excluded.total, amount_due = excluded.amount_due, amount_paid = excluded.amount_paid, currency = excluded.currency,
                    repeating_invoice_id = excluded.repeating_invoice_id, line_items = excluded.line_items,
                    updated_utc = excluded.updated_utc, synced_at = now()`;
      }
      invoices += list.length;
      if (list.length < 100) break;
    }
    const rep = await xeroGet('/RepeatingInvoices', auth);
    const templates = ((rep?.RepeatingInvoices || []) as any[]).filter(r => r.Type === 'ACCREC');
    await sql.begin(async tx => {
      await tx`delete from public.xero_repeating_invoices`;
      for (const r of templates) {
        const s = r.Schedule || {};
        await tx`insert into public.xero_repeating_invoices (repeating_invoice_id, contact_id, contact_name, status, reference, period, unit,
                   start_date, next_date, end_date, sub_total, total, line_items)
                 values (${r.RepeatingInvoiceID}, ${r.Contact?.ContactID || ''}, ${r.Contact?.Name || ''}, ${r.Status || ''}, ${r.Reference || ''},
                   ${s.Period ?? null}, ${s.Unit || ''}, ${xeroDate(s.StartDateString || s.StartDate)},
                   ${xeroDate(s.NextScheduledDateString || s.NextScheduledDate)}, ${xeroDate(s.EndDateString || s.EndDate)},
                   ${r.SubTotal ?? 0}, ${r.Total ?? 0}, ${sql.json(lines(r.LineItems))})`;
      }
    });
    const [{ n }] = await sql`select count(*)::int as n from public.xero_invoices`;
    await sql`update public.xero_status set last_sync_at = now(), last_sync_ok = true, last_error = '',
              invoices = ${n}, repeating = ${templates.length}, modified_at = now() where id = 1`;
    return { ok: true, changed: invoices, invoices: n, repeating: templates.length };
  } catch (err) {
    const message = String((err as Error).message || err).slice(0, 500);
    await sql`update public.xero_status set last_sync_at = now(), last_sync_ok = false, last_error = ${message}, modified_at = now() where id = 1`;
    return { ok: false, error: message };
  }
}
