// Pulls Xero into the database: hourly from the scheduler (x-cron-secret) or on demand by staff
// ("Sync now"). Public at the gateway so the scheduler can call it; checks one of the two itself.
import { cors, json, sql, staffEmail, sync } from '../_shared/xero.ts';

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
    const [conn] = await sql`select 1 from private.xero_tokens where id = 1`;
    if (!conn) return json({ ok: false, error: 'Xero is not connected yet' });
    return json(await sync());
  } catch (err) {
    return json({ ok: false, error: String((err as Error).message || err) }, 500);
  }
});
