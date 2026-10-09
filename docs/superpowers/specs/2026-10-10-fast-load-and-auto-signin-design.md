# Faster loading and automatic re-sign-in

Jack, 10 Oct 2026: "performance should be fairly instant now it's on Supabase"; "easy to log in on
mobile after closing the app … pop ups block the view".

## Re-sign-in
- Why it happened: Entra gives web apps (SPA) a 24h refresh token. After that MSAL tries a hidden
  iframe, which iOS (ITP) blocks in the installed app, so `getToken()` fell to `markAuthExpired()`:
  sign-in screen + "session expired" toast, then the account picker (`prompt: 'select_account'`).
- Now `markAuthExpired()` first does `loginRedirect` with `loginHint` = the account. Microsoft's own
  first-party cookie normally outlives the refresh token, so it comes straight back signed in, no tap,
  and `init()` reopens the section (`state: 'gecko-resume:<section>'`).
- Loop guard: at most one automatic redirect per 2 minutes (`gecko.auth.autoRedirectAt.v1`); a second
  failure inside that falls back to the old sign-in screen. `authRedirecting` stops parallel failures
  starting two redirects.
- Manual Sign in hints the account this device last used; the picker only on a first sign-in.
- Removed the "Welcome back" toast (full width over the bottom of the screen on a phone, every open).
- Not done: the Supabase "Connect" card still needs one tap per device when the database session is
  missing (its silent path is the same blocked iframe). Supabase keeps its own session afterwards.

## Speed
- `is_gecko_staff` was asked before every database read and write (`connectSupabase` drops its
  promise when done). Remembered per Supabase user id; cleared on sign-out.
- Overview, Profitability, Clients and Opportunities looked up the SharePoint site and every list
  (two Graph calls, in sequence) before reading the database, and failed if lists they no longer read
  were missing. Skipped when their data is on Supabase. `resolveSiteId`/`fetchAllLists` share the
  in-flight promise.
- SheetJS (~900 KB) was parser-blocking in `<head>`; `pnlEnsureXlsx()` already loads it on demand.
- supabase-js is `modulepreload`ed and supabase.co preconnected, so it downloads during start-up
  instead of after sign-in.
- Three inline base64 copies of the icon (145 KB) replaced by the identical repo files.
- Opportunities: prospects load beside the main batch instead of after it.

## Deferred (ask before doing)
- Timesheets renders only after the Lists backup sync (`tshDbLoad`). Rendering first and syncing in
  the background would be faster, but a save during the sync could push a pending row twice and the
  flow would add its hours to `HoursUsed` twice. Needs a lock on `tshPush` first.
- Overview waits for every source before drawing anything; render-as-they-arrive needs per-tile
  loading states (a loading tile must not look like an error or an empty one).
- One shared short-lived cache for gecko_clients / gecko_services / profit_feed across sections.
- Client page reads 13 whole tables per client; filter by client on the server.
