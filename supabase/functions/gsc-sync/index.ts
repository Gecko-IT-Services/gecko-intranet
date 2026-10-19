// Search Console sync: daily from the scheduler (x-cron-secret) or on demand by staff (SEO › Sync now). Read only towards Google.
// Design: docs/superpowers/specs/2026-10-20-search-console-design.md
import { cors, json, sql, staffEmail } from '../_shared/xero.ts';
import { syncSearch } from './sync.ts';

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
    return json(await syncSearch());
  } catch (err) {
    return json({ ok: false, error: String((err as Error).message || err) }, 500);
  }
});
