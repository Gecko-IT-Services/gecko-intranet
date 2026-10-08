// Shared by the xero-* Edge Functions. Runs on Supabase, never in the browser.
// Design: docs/superpowers/specs/2026-10-08-xero-integration-design.md
//
// Secrets (Supabase › Edge Functions › Secrets): XERO_CLIENT_ID, XERO_CLIENT_SECRET,
// optional XERO_SCOPES. Supabase provides SUPABASE_DB_URL, SUPABASE_URL, SUPABASE_ANON_KEY.

import postgres from 'npm:postgres@3.4.4';

export const SITE_URL = 'https://gecko-it-services.github.io/gecko-intranet/';
export const REDIRECT_URI = 'https://nkobrqzsogtyxriqqwnq.supabase.co/functions/v1/xero-callback';
// Sales invoices and repeating invoices (the granular scope new Xero apps must use from
// 2 March 2026): read, plus creating DRAFT invoices from Jobs (xero-invoice); offline_access for
// a refresh token. Overridable without a deploy.
export const SCOPES = Deno.env.get('XERO_SCOPES') || 'offline_access accounting.invoices';

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

/** POST to Xero; its validation messages are returned as the error. */
async function xeroPost(path: string, auth: { token: string; tenant: string }, body: unknown, idempotencyKey: string) {
  const res = await fetch(`${API}${path}`, {
    method: 'POST',
    headers: { authorization: `Bearer ${auth.token}`, 'xero-tenant-id': auth.tenant, accept: 'application/json',
      'content-type': 'application/json', 'idempotency-key': idempotencyKey },
    body: JSON.stringify(body)
  });
  const text = await res.text();
  let data: any = null;
  try { data = JSON.parse(text); } catch { /* not JSON */ }
  if (!res.ok) {
    const msgs = (data?.Elements || []).flatMap((e: any) => (e.ValidationErrors || []).map((v: any) => v.Message)).filter(Boolean);
    if (res.status === 401 || res.status === 403) throw new Error(`Xero refused (${res.status}): reconnect Xero (Jobs › Sales this month › Reconnect) to allow creating draft invoices`);
    throw new Error(`Xero ${res.status}: ${msgs.join('; ') || data?.Message || text.slice(0, 200)}`);
  }
  return data;
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

/** One Xero invoice (as the API returns it) into public.xero_invoices. */
async function saveInvoice(i: any) {
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
        await saveInvoice(i);
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
    // Never let moving jobs on fail the sync itself.
    await advanceJobs().catch(err => console.error('advanceJobs:', err));
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

/**
 * An open job (agreed, in progress or to invoice) moves to Invoiced by itself once the invoices created for it from
 * Jobs are approved in Xero and cover its value (dated as the latest of them). Invoices typed on
 * a job by hand are only shown, never acted on.
 */
async function advanceJobs() {
  await sql`update public.jobs j set status = 'invoiced', invoiced_at = x.last_date
            from (select p.job_id, sum(i.sub_total) as raised, max(i.invoice_date) as last_date
                    from public.xero_pushes p join public.xero_invoices i on i.invoice_id = p.invoice_id
                   where p.state = 'done' and i.status in ('AUTHORISED', 'PAID') group by p.job_id) x
            where j.id = x.job_id and j.status in ('agreed', 'in_progress', 'to_invoice') and j.value is not null and x.raised >= j.value`;
}

const round2 = (n: number) => Math.round(n * 100) / 100;

/**
 * Contacts and item codes Gecko has invoiced before (from synced invoices): the only ones offered,
 * with the contact whose name matches `clientName` suggested.
 */
async function contactsAndItems(clientName: string) {
  const contacts = await sql`select distinct on (contact_id) contact_id as id, contact_name as name
                             from public.xero_invoices where contact_id <> '' and status <> 'DELETED'
                             order by contact_id, invoice_date desc nulls last`;
  contacts.sort((a: any, b: any) => a.name.localeCompare(b.name));
  const norm = (t: string) => String(t || '').toLowerCase().replace(/\b(ltd|limited|plc|llp)\b|[^a-z0-9]/g, '');
  const want = norm(clientName);
  const match = contacts.find((c: any) => norm(c.name) === want)
    || contacts.find((c: any) => want && (norm(c.name).startsWith(want) || want.startsWith(norm(c.name))));
  // One-off work's item codes, most used first, with the account each is booked to.
  const items = await sql`select li->>'item_code' as code, mode() within group (order by li->>'account_code') as account,
                                 count(*)::int as uses
                          from public.xero_invoices, jsonb_array_elements(line_items) li
                          where status in ('AUTHORISED','PAID') and coalesce(repeating_invoice_id, '') = ''
                            and coalesce(li->>'item_code', '') <> '' and coalesce(li->>'account_code', '') <> ''
                          group by 1 order by 3 desc, 1`;
  return { contacts, suggested: match?.id || null, items };
}

/** For Invoice in Xero on a job. */
export async function invoiceOptions(jobId: number) {
  const [job] = await sql`select id, client_name, title, value, invoice_ref from public.jobs where id = ${jobId}`;
  if (!job) throw new Error('That job no longer exists');
  const { contacts, suggested, items } = await contactsAndItems(job.client_name);
  const pushes = await sql`select p.invoice_number, p.amount::float, p.state, i.status
                           from public.xero_pushes p left join public.xero_invoices i on i.invoice_id = p.invoice_id
                           where p.job_id = ${jobId} and p.state = 'done' order by p.created_at`;
  const raised = round2(pushes.filter((p: any) => !['VOIDED', 'DELETED'].includes(p.status)).reduce((t: number, p: any) => t + p.amount, 0));
  return {
    job: { id: job.id, client_name: job.client_name, title: job.title, value: job.value == null ? null : Number(job.value) },
    contacts, suggested, items, raised, pushes
  };
}

/** For an SSA renewal: the contacts and items, and drafts already made for this client lately. */
export async function ssaOptions(clientName: string, ssaClientId: number | null) {
  const { contacts, suggested, items } = await contactsAndItems(clientName);
  const recent = ssaClientId ? await sql`select p.invoice_number, p.invoice_id, p.quantity::float, p.amount::float, p.created_at, p.created_by, i.status
                       from public.xero_pushes p left join public.xero_invoices i on i.invoice_id = p.invoice_id
                       where p.source = 'ssa' and p.ssa_client_id = ${ssaClientId} and p.state = 'done'
                         and p.created_at > now() - interval '45 days' order by p.created_at desc` : [];
  return { contacts, suggested, items, recent };
}

export interface DraftRequest {
  source?: 'job' | 'ssa';
  job_id?: number; ssa_client_id?: number | null; client_name?: string;
  request_key: string; contact_id: string; item_code: string;
  description: string; amount: number; quantity?: number; reference?: string;
}

/** Checks a draft request; returns the problem in words, or ''. */
export function draftProblem(r: Partial<DraftRequest>) {
  const source = r.source || 'job';
  if (source !== 'job' && source !== 'ssa') return 'Unknown source';
  if (source === 'job' && !Number.isInteger(r.job_id)) return 'Which job?';
  if (source === 'ssa' && !String(r.client_name || '').trim()) return 'Which SSA client?';
  if (source === 'ssa' && r.ssa_client_id != null && !Number.isInteger(r.ssa_client_id)) return 'Which SSA client?';
  const q = r.quantity == null ? 1 : Number(r.quantity);
  if (!Number.isInteger(q) || q < 1 || q > 100) return 'The quantity must be a whole number from 1 to 100';
  if (!/^[A-Za-z0-9-]{16,80}$/.test(String(r.request_key || ''))) return 'Missing request key';
  if (!r.contact_id) return 'Choose the Xero contact';
  if (!r.item_code) return 'Choose the item';
  const d = String(r.description || '').trim();
  if (!d) return 'Describe the work';
  if (d.length > 4000) return 'The description is too long (4,000 characters at most)';
  const a = Number(r.amount);
  if (!(a > 0) || a * q > 1000000 || Math.abs(Math.round(a * 100) - a * 100) > 1e-6) return 'Enter the amount (net, in pounds and pence)';
  if (String(r.reference || '').length > 255) return 'The reference is too long';
  return '';
}

/** Today in London, and a date `days` later (YYYY-MM-DD). */
function londonDates(days: number) {
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/London' }).format(new Date());
  const due = new Date(today + 'T00:00:00Z');
  due.setUTCDate(due.getUTCDate() + days);
  return { today, due: due.toISOString().slice(0, 10) };
}

/**
 * Creates a DRAFT sales invoice in Xero for a job, once per request key: a second call with the
 * same key returns the first result (and Xero gets the key as its Idempotency-Key too). The
 * contact and item must be ones Gecko has invoiced before; the account comes from the item's
 * history and VAT from that account's default. Due date: the contact's usual terms (their last
 * invoice), else 14 days. The invoice number is added to the job.
 */
export async function createDraft(r: DraftRequest, email: string) {
  const problem = draftProblem(r);
  if (problem) throw new Error(problem);
  const [tok] = await sql`select scopes from private.xero_tokens where id = 1`;
  if (!tok) throw new Error('Xero is not connected');
  if (!String(tok.scopes || '').split(/\s+/).includes('accounting.invoices')) {
    throw new Error('Xero was connected read-only. Reconnect Xero (Jobs › Sales this month › Reconnect) to allow draft invoices.');
  }
  const source = r.source || 'job';
  const opts = source === 'job' ? await invoiceOptions(r.job_id!) : await contactsAndItems(String(r.client_name));
  const contact = opts.contacts.find((c: any) => c.id === r.contact_id);
  if (!contact) throw new Error('That contact has no invoices in Xero yet; create the first invoice in Xero');
  const item = opts.items.find((i: any) => i.code === r.item_code);
  if (!item) throw new Error('That item has not been used on an invoice before');
  const unit = round2(Number(r.amount));
  const quantity = r.quantity == null ? 1 : Number(r.quantity);
  const amount = round2(unit * quantity);
  const jobId = source === 'job' ? r.job_id! : null;
  const ssaId = source === 'ssa' ? (r.ssa_client_id ?? null) : null;
  const description = String(r.description).trim();
  const reference = String(r.reference || '').trim();

  // Claim the request key first: a double click finds the claim and stops here.
  const claimed = await sql`insert into public.xero_pushes (request_key, source, job_id, ssa_client_id, contact_id, contact_name, item_code, account_code, description, quantity, amount, created_by)
                            values (${r.request_key}, ${source}, ${jobId}, ${ssaId}, ${contact.id}, ${contact.name}, ${item.code}, ${item.account}, ${description}, ${quantity}, ${amount}, ${email})
                            on conflict (request_key) do nothing returning id`;
  if (!claimed.length) {
    const [prev] = await sql`select state, invoice_id, invoice_number, error from public.xero_pushes where request_key = ${r.request_key}`;
    if (prev?.state === 'done') return { invoice_id: prev.invoice_id, invoice_number: prev.invoice_number, repeat: true };
    if (prev?.state === 'pending') throw new Error('This invoice is already being created; refresh in a moment');
    // A failed attempt may be retried with the same key (Xero's idempotency covers a half-done call).
    await sql`update public.xero_pushes set state = 'pending', error = '', contact_id = ${contact.id}, contact_name = ${contact.name},
              item_code = ${item.code}, account_code = ${item.account}, description = ${description}, quantity = ${quantity}, amount = ${amount}
              where request_key = ${r.request_key}`;
  }
  try {
    const [terms] = await sql`select (due_date - invoice_date) as days from public.xero_invoices
                              where contact_id = ${contact.id} and due_date is not null and invoice_date is not null
                                and status in ('AUTHORISED','PAID') order by invoice_date desc limit 1`;
    const days = terms && terms.days >= 0 && terms.days <= 120 ? Number(terms.days) : 14;
    const { today, due } = londonDates(days);
    const auth = await accessToken();
    const body = await xeroPost('/Invoices', auth, { Invoices: [{
      Type: 'ACCREC', Status: 'DRAFT', Contact: { ContactID: contact.id }, Date: today, DueDate: due,
      LineAmountTypes: 'Exclusive', Reference: reference,
      LineItems: [{ Description: description, Quantity: quantity, UnitAmount: unit, ItemCode: item.code, AccountCode: item.account }]
    }] }, r.request_key);
    const inv = body?.Invoices?.[0];
    if (!inv?.InvoiceID) throw new Error('Xero did not return the invoice');
    await saveInvoice(inv);
    await sql`update public.xero_pushes set state = 'done', invoice_id = ${inv.InvoiceID}, invoice_number = ${inv.InvoiceNumber || ''},
              done_at = now() where request_key = ${r.request_key}`;
    if (inv.InvoiceNumber && jobId != null) {
      await sql`update public.jobs set invoice_ref = case when invoice_ref = '' then ${inv.InvoiceNumber}
                  else invoice_ref || ', ' || ${inv.InvoiceNumber} end where id = ${jobId}`;
    }
    return { invoice_id: inv.InvoiceID as string, invoice_number: (inv.InvoiceNumber || '') as string, due, total: amount, repeat: false };
  } catch (err) {
    const message = String((err as Error).message || err).slice(0, 500);
    await sql`update public.xero_pushes set state = 'failed', error = ${message} where request_key = ${r.request_key}`;
    throw new Error(message);
  }
}

/**
 * "Nudge" on Jobs › Owed to us: who to write to, and each invoice's pay-online link, from Xero
 * (read only; the email itself is drafted in the browser, in the person's own Outlook Drafts).
 * Only unpaid, approved invoices of that contact are looked up. Calls: 1 + one per invoice (max 20).
 */
export async function nudgeInfo(contactId: string, invoiceIds: string[]) {
  const ids = [...new Set((invoiceIds || []).map(String).filter(Boolean))].slice(0, 20);
  if (!contactId || !ids.length) throw new Error('Which contact and invoices?');
  const rows = await sql`select invoice_id from public.xero_invoices
                         where contact_id = ${contactId} and invoice_id in ${sql(ids)} and status = 'AUTHORISED' and amount_due > 0
                         order by due_date`;
  if (!rows.length) throw new Error('No unpaid invoices for that contact (Xero may have synced a payment since)');
  const auth = await accessToken();
  const inv = (await xeroGet(`/Invoices/${rows[0].invoice_id}`, auth))?.Invoices?.[0];
  const c = inv?.Contact || {};
  // Xero's "include in emails" people are who its own invoice emails go to.
  const cc = (c.ContactPersons || []).filter((p: any) => p.IncludeInEmails && p.EmailAddress).map((p: any) => String(p.EmailAddress));
  const links: Record<string, string> = {};
  for (const r of rows) {
    try {
      const url = (await xeroGet(`/Invoices/${r.invoice_id}/OnlineInvoice`, auth))?.OnlineInvoices?.[0]?.OnlineInvoiceUrl;
      if (url) links[r.invoice_id] = String(url);
    } catch { /* no online link for this one: the email simply doesn't offer it */ }
  }
  return {
    email: String(c.EmailAddress || ''), cc: cc.filter((e: string) => e.toLowerCase() !== String(c.EmailAddress || '').toLowerCase()),
    firstName: String(c.FirstName || ''), contactName: String(c.Name || ''), links
  };
}
