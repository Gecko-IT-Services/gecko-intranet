// "Invoice in Xero" on a job: staff only. { action: 'options', job_id } returns the contacts and
// items to choose from; { action: 'create', … } creates a DRAFT sales invoice in Xero (once per
// request key). Philip approves and sends it in Xero itself.
import { cors, createDraft, invoiceOptions, json, staffEmail } from '../_shared/xero.ts';

Deno.serve(async req => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  try {
    const email = await staffEmail(req);
    if (!email) return json({ error: 'Only Gecko staff can invoice from Jobs' }, 403);
    const body = await req.json().catch(() => ({}));
    const jobId = Number(body.job_id);
    if (body.action === 'options') return json(await invoiceOptions(jobId));
    if (body.action === 'create') return json({ ok: true, ...(await createDraft({ ...body, job_id: jobId }, email)) });
    return json({ error: 'Unknown action' }, 400);
  } catch (err) {
    return json({ error: String((err as Error).message || err) }, 400);
  }
});
