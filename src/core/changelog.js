/* Change log: what has been merged into the app, and by whom (no window). Tested in tests/changelog.mjs.
   Design: docs/superpowers/specs/2026-10-12-change-log-design.md

   Jack, 12 Oct: "so I can keep track of the changes dad has made and dad can keep up with mine". The
   entries are the repository's merged pull requests, read from GitHub by the browser: the repository is
   public, so there is no key and nothing to keep up to date by hand. */

export const REPO = 'Gecko-IT-Services/gecko-intranet';
export const SHOWN = 100;              // ponytail: the newest 100; older ones are a link to GitHub
export const FRESH_MS = 15 * 60000;    // GitHub allows 10 searches a minute without signing in; this asks 4 an hour
/** GitHub account → person. An account not listed here shows under its own name. */
export const AUTHORS = { 'Gecko-IT': 'Jack', PhilipGecko99: 'Philip' };

export const SEARCH_URL = `https://api.github.com/search/issues?q=${encodeURIComponent(`repo:${REPO} is:pr is:merged`)}&sort=updated&order=desc&per_page=${SHOWN}`;
export const ALL_URL = `https://github.com/${REPO}/pulls?q=is%3Apr+is%3Amerged`;

const oneLine = s => String(s ?? '').replace(/\s+/g, ' ').trim();

/** GitHub's search rows → [{ number, title, who, at, url }], merged ones only, newest first. */
export function toEntries(items) {
  return (Array.isArray(items) ? items : [])
    .filter(i => i?.pull_request?.merged_at)
    .map(i => ({
      number: Number(i.number), title: oneLine(i.title),
      who: AUTHORS[i.user?.login] || oneLine(i.user?.login),
      at: String(i.pull_request.merged_at),
      url: /^https:\/\/github\.com\//.test(String(i.html_url ?? '')) ? String(i.html_url) : ''
    }))
    .sort((a, b) => b.at.localeCompare(a.at));
}

/** The reader's own calendar day for a merge time. */
export function localDay(at) {
  const d = new Date(at);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/** [{ day: 'YYYY-MM-DD', entries }] in the order given (newest first). */
export function byDay(entries, dayKey = localDay) {
  const days = [];
  for (const e of entries) {
    const day = dayKey(e.at);
    if (days.at(-1)?.day !== day) days.push({ day, entries: [] });
    days.at(-1).entries.push(e);
  }
  return days;
}

export function dayLabel(day, today) {
  const diff = Math.round((Date.parse(today + 'T00:00:00Z') - Date.parse(day + 'T00:00:00Z')) / 86400000);
  if (diff === 0) return 'Today';
  if (diff === 1) return 'Yesterday';
  return new Date(day + 'T00:00:00Z').toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' }).replace(',', '');
}

/** The other person's changes since `seenAt` (an ISO time). Nothing when either is unknown. */
export function unseen(entries, me, seenAt) {
  if (!me || !seenAt) return [];
  return entries.filter(e => e.who !== me && Date.parse(e.at) > Date.parse(seenAt));
}

/** The newest merged pull requests, or an error whose message can be shown as it is. */
export async function fetchEntries(fetchFn = fetch) {
  let res;
  try { res = await fetchFn(SEARCH_URL, { headers: { Accept: 'application/vnd.github+json' } }); }
  catch { throw new Error('Could not reach GitHub. Check the connection and try again.'); }
  if (res.status === 403 || res.status === 429) throw new Error('GitHub is limiting requests from this connection. Try again in a minute.');
  if (!res.ok) throw new Error(`GitHub answered ${res.status}.`);
  const body = await res.json();
  if (!Array.isArray(body?.items)) throw new Error('GitHub answered, but not with a list of changes.');
  return toEntries(body.items);
}
