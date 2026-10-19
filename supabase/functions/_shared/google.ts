// Google Search Console, read only (webmasters.readonly). Shared by google-auth, google-callback and gsc-sync. Secrets: GOOGLE_CLIENT_ID,
// GOOGLE_CLIENT_SECRET. Design: docs/superpowers/specs/2026-10-20-search-console-design.md
import { sql } from './xero.ts';

export const REDIRECT = 'https://nkobrqzsogtyxriqqwnq.supabase.co/functions/v1/google-callback';
export const SCOPES = 'https://www.googleapis.com/auth/webmasters.readonly openid email';
const TOKEN = 'https://oauth2.googleapis.com/token';

function creds() {
  const id = (Deno.env.get('GOOGLE_CLIENT_ID') || '').trim(), secret = (Deno.env.get('GOOGLE_CLIENT_SECRET') || '').trim();
  if (!id || !secret) throw new Error('GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET are not set in Supabase › Edge Functions › Secrets');
  return { id, secret };
}

export function authorizeUrl(state: string) {
  const q = new URLSearchParams({ client_id: creds().id, redirect_uri: REDIRECT, response_type: 'code', scope: SCOPES, access_type: 'offline',
    prompt: 'consent', include_granted_scopes: 'true', state });
  return `https://accounts.google.com/o/oauth2/v2/auth?${q}`;
}

/** The code from the consent screen → tokens kept in private.google_tokens; → the Google account's email. */
export async function connect(code: string, by: string) {
  const { id, secret } = creds();
  const res = await fetch(TOKEN, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ code, client_id: id, client_secret: secret, redirect_uri: REDIRECT, grant_type: 'authorization_code' }) });
  const t = await res.json().catch(() => ({}));
  if (!res.ok || !t.refresh_token) throw new Error(t.error_description || t.error || 'Google gave no refresh token: remove Gecko HQ under myaccount.google.com › Security › Third-party access, then connect again');
  const email = (() => { try { return JSON.parse(atob(String(t.id_token).split('.')[1].replace(/-/g, '+').replace(/_/g, '/'))).email || ''; } catch { return ''; } })();
  await sql`insert into private.google_tokens (id, refresh_token, access_token, access_expires, scopes, google_email, connected_by)
            values (1, ${t.refresh_token}, ${t.access_token}, now() + make_interval(secs => ${Number(t.expires_in) || 3000}), ${t.scope || ''}, ${email}, ${by})
            on conflict (id) do update set refresh_token = excluded.refresh_token, access_token = excluded.access_token, access_expires = excluded.access_expires,
              scopes = excluded.scopes, google_email = excluded.google_email, connected_by = excluded.connected_by, connected_at = now()`;
  await sql`update public.google_status set connected = true, google_email = ${email}, last_error = '' where id = 1`;
  return email;
}

/** A current access token (refreshed when within five minutes of expiring). */
export async function accessToken() {
  const [row] = await sql`select refresh_token, access_token, access_expires from private.google_tokens where id = 1`;
  if (!row) throw new Error('Search Console isn’t connected: press Connect Search Console on the SEO page');
  if (row.access_token && row.access_expires && new Date(row.access_expires).getTime() - Date.now() > 5 * 60000) return row.access_token;
  const { id, secret } = creds();
  const res = await fetch(TOKEN, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ refresh_token: row.refresh_token, client_id: id, client_secret: secret, grant_type: 'refresh_token' }) });
  const t = await res.json().catch(() => ({}));
  if (!res.ok) {
    if (t.error === 'invalid_grant') await sql`update public.google_status set connected = false where id = 1`;
    throw new Error(t.error === 'invalid_grant' ? 'Google sign-in has expired or was removed: press Connect Search Console again' : (t.error_description || t.error || `Google token ${res.status}`));
  }
  await sql`update private.google_tokens set access_token = ${t.access_token}, access_expires = now() + make_interval(secs => ${Number(t.expires_in) || 3000}) where id = 1`;
  return t.access_token as string;
}

/** Which Search Console property a site's domain is: a domain property first, then https://www., https://, http://. */
export function propertyFor(domain: string, properties: string[]) {
  const d = domain.toLowerCase().replace(/^www\./, '');
  return [`sc-domain:${d}`, `https://www.${d}/`, `https://${d}/`, `http://www.${d}/`, `http://${d}/`].find(p => properties.includes(p)) || null;
}
