// "Invoice in Xero" on a job, and on an SSA renewal: staff only. { action: 'options', job_id } or
// { action: 'ssa-options', client_name, ssa_client_id } returns the contacts and items to choose
// from; { action: 'create', source: 'job' | 'ssa', … } creates a DRAFT sales invoice in Xero (once per
// request key). Philip approves and sends it in Xero itself. { action: 'nudge', contact_id, invoice_ids }
// returns the contact's email and pay-online links for a payment reminder (read only).
import { cors, createDraft, invoiceOptions, json, nudgeInfo, ssaOptions, staffEmail } from '../_shared/xero.ts';

Deno.serve(async req => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  try {
    const email = await staffEmail(req);
    if (!email) return json({ error: 'Only Gecko staff can invoice from Jobs' }, 403);
    const body = await req.json().catch(() => ({}));
    const jobId = Number(body.job_id);
    const ssaId = body.ssa_client_id == null || body.ssa_client_id === '' ? null : Number(body.ssa_client_id);
    if (body.action === 'options') return json(await invoiceOptions(jobId));
    if (body.action === 'ssa-options') return json(await ssaOptions(String(body.client_name || ''), ssaId));
    if (body.action === 'nudge') return json(await nudgeInfo(String(body.contact_id || ''), body.invoice_ids || []));
    if (body.action === 'create') {
      const req = body.source === 'ssa' ? { ...body, ssa_client_id: ssaId } : { ...body, source: 'job', job_id: jobId };
      return json({ ok: true, ...(await createDraft(req, email)) });
    }
    return json({ error: 'Unknown action' }, 400);
  } catch (err) {
    return json({ error: String((err as Error).message || err) }, 400);
  }
});
