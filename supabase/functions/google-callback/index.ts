// Google sends the browser here after the consent screen. Public by necessity (no Supabase session on a redirect), so it trusts nothing
// but a state it issued in the last 15 minutes. Design: docs/superpowers/specs/2026-10-20-search-console-design.md
import { SITE_URL, sql } from '../_shared/xero.ts';
import { connect } from '../_shared/google.ts';
import { syncSearch } from '../gsc-sync/sync.ts';

const back = (result: string, detail = '') =>
  Response.redirect(`${SITE_URL}#google=${encodeURIComponent(result)}${detail ? '&detail=' + encodeURIComponent(detail.slice(0, 200)) : ''}`, 302);

Deno.serve(async req => {
  const p = new URL(req.url).searchParams;
  if (p.get('error')) return back('error', p.get('error_description') || p.get('error') || '');
  const code = p.get('code'), state = p.get('state');
  if (!code || !state) return back('error', 'Missing code or state');
  try {
    const [row] = await sql`delete from private.google_oauth_states where state = ${state}
                            and created_at > now() - interval '15 minutes' returning email`;
    if (!row) return back('error', 'This Connect link has expired. Press Connect Search Console again.');
    const email = await connect(code, row.email);
    const r = await syncSearch();
    return back(r.ok ? 'connected' : 'connected-sync-failed', r.ok ? `${email}: ${r.matched} of ${r.sites} sites found` : r.error);
  } catch (err) {
    return back('error', String((err as Error).message || err));
  }
});
