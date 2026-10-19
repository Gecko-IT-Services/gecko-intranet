// Starts "Connect Search Console": staff only. Returns Google's consent URL with a one-time state.
// Design: docs/superpowers/specs/2026-10-20-search-console-design.md
import { cors, json, sql, staffEmail } from '../_shared/xero.ts';
import { authorizeUrl } from '../_shared/google.ts';

Deno.serve(async req => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  try {
    const email = await staffEmail(req);
    if (!email) return json({ error: 'Only Gecko staff can connect Search Console' }, 403);
    const state = crypto.randomUUID() + crypto.randomUUID();
    await sql`delete from private.google_oauth_states where created_at < now() - interval '1 hour'`;
    await sql`insert into private.google_oauth_states (state, email) values (${state}, ${email})`;
    return json({ url: authorizeUrl(state) });
  } catch (err) {
    return json({ error: String((err as Error).message || err) }, 500);
  }
});
