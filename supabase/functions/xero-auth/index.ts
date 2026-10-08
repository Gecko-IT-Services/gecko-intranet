// Starts "Connect Xero": staff only. Returns the Xero consent URL with a one-time state.
import { authorizeUrl, cors, json, sql, staffEmail } from '../_shared/xero.ts';

Deno.serve(async req => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  try {
    const email = await staffEmail(req);
    if (!email) return json({ error: 'Only Gecko staff can connect Xero' }, 403);
    const state = crypto.randomUUID() + crypto.randomUUID();
    await sql`delete from private.xero_oauth_states where created_at < now() - interval '1 hour'`;
    await sql`insert into private.xero_oauth_states (state, email) values (${state}, ${email})`;
    return json({ url: authorizeUrl(state) });
  } catch (err) {
    return json({ error: String((err as Error).message || err) }, 500);
  }
});
