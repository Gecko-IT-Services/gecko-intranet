/**
 * The one Supabase client, and signing in to it with the Microsoft account
 * the person is already signed in with.
 *
 * How the sign-in works: MSAL asks Microsoft for a fresh ID token carrying
 * sha256(nonce); Supabase checks that token (Azure provider, Gecko tenant)
 * against the raw nonce and opens its own session, kept in localStorage and
 * refreshed by the library. One Microsoft sign-in, no second password.
 *
 * Nothing here runs at import time, so modules that import this stay
 * importable under Node; the library itself is fetched on first use.
 */

const SUPABASE_JS = 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.116.0/+esm';
const STORAGE_KEY = 'gecko.supabase.auth';

let clientPromise  = null;
let connectPromise = null;

/** The site's CONFIG is a classic-script const: reachable by name, not on window. */
function config() {
  // eslint-disable-next-line no-undef
  return typeof CONFIG !== 'undefined' ? CONFIG : window.CONFIG;
}

export function getSupabase() {
  clientPromise ??= import(SUPABASE_JS).then(({ createClient }) =>
    createClient(config().SUPABASE_URL, config().SUPABASE_KEY, {
      auth: { storageKey: STORAGE_KEY, persistSession: true, autoRefreshToken: true }
    }));
  return clientPromise;
}

export async function sha256Hex(text) {
  const bytes = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return [...new Uint8Array(bytes)].map(b => b.toString(16).padStart(2, '0')).join('');
}

/**
 * A signed-in client for a Gecko staff member, or a thrown error that says
 * which: DB_SIGNIN_REQUIRED (needs a click), NOT_STAFF, or Supabase's own.
 * `interactive` must only be true inside a click handler (it may open a popup).
 */
export function connectSupabase({ interactive = false } = {}) {
  connectPromise ??= connect(interactive).finally(() => { connectPromise = null; });
  return connectPromise;
}

async function connect(interactive) {
  const sb = await getSupabase();
  const msEmail = (window.activeAccountEmail?.() || '').toLowerCase();

  let { data: { session } } = await sb.auth.getSession();
  // A session left behind by someone else on this device is not this person's.
  if (session && msEmail && session.user?.email?.toLowerCase() !== msEmail) {
    await sb.auth.signOut();
    session = null;
  }
  if (!session) {
    const nonce   = crypto.randomUUID();
    const idToken = await window.getIdTokenForNonce(await sha256Hex(nonce), { interactive });
    const { error } = await sb.auth.signInWithIdToken({ provider: 'azure', token: idToken, nonce });
    if (error) throw error;
  }

  // Row-level security answers an outsider with empty tables, which would
  // look like "no data". Ask once, so that case is an error, never an empty state.
  const { data: isStaff, error } = await sb.rpc('is_gecko_staff');
  if (error) throw error;
  if (!isStaff) {
    const e = new Error('Your account is not on the staff list in Supabase (table: staff).');
    e.code = 'NOT_STAFF';
    throw e;
  }
  return sb;
}

/** Called on Microsoft sign-out, so the database session never outlives it. */
export function forgetSupabaseSession() {
  try { localStorage.removeItem(STORAGE_KEY); } catch { /* storage blocked: nothing kept */ }
  clientPromise = null;
}
