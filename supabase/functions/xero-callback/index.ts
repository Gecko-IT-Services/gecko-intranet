// Xero sends the browser here after the consent screen. Public by necessity (no Supabase
// session on a redirect), so it trusts nothing but a state it issued in the last 15 minutes.
import { SITE_URL, connect, sql, sync } from '../_shared/xero.ts';

const back = (result: string, detail = '') =>
  Response.redirect(`${SITE_URL}#xero=${encodeURIComponent(result)}${detail ? '&detail=' + encodeURIComponent(detail.slice(0, 200)) : ''}`, 302);

Deno.serve(async req => {
  const p = new URL(req.url).searchParams;
  if (p.get('error')) return back('error', p.get('error_description') || p.get('error') || '');
  const code = p.get('code'), state = p.get('state');
  if (!code || !state) return back('error', 'Missing code or state');
  try {
    const [row] = await sql`delete from private.xero_oauth_states where state = ${state}
                            and created_at > now() - interval '15 minutes' returning email`;
    if (!row) return back('error', 'This Connect link has expired. Click Connect Xero again.');
    const org = await connect(code, row.email);
    const result = await sync();
    return back(result.ok ? 'connected' : 'connected-sync-failed', result.ok ? org : result.error);
  } catch (err) {
    return back('error', String((err as Error).message || err));
  }
});
