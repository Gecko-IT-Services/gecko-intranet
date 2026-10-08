/* Activity & follow-ups per client: pure logic (no window). Tested in tests/activity.mjs.
   Design: docs/superpowers/specs/2026-10-09-client-activity-design.md */

import { sameClient } from './client.js';

export const KINDS = [['note', 'Note'], ['call', 'Call'], ['email', 'Email'], ['meeting', 'Meeting'], ['visit', 'Visit']];
const day = d => String(d || '').slice(0, 10);

export function addDays(key, n) {
  const d = new Date(key + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}
const daysBetween = (a, b) => Math.round((Date.parse(b + 'T00:00:00Z') - Date.parse(a + 'T00:00:00Z')) / 86400000);

/** The follow-up shortcuts: tomorrow, next Monday, in 2 weeks, in a month. */
export function followUpChoices(today) {
  const dow = new Date(today + 'T00:00:00Z').getUTCDay();
  return [
    ['Tomorrow', addDays(today, 1)],
    ['Next week', addDays(today, ((8 - dow) % 7) || 7)],
    ['In 2 weeks', addDays(today, 14)],
    ['In a month', addDays(today, 30)]
  ];
}

/** Tidy what was typed. Returns { row } or { error }. */
export function cleanActivity(input, clientName, today) {
  const client = String(clientName || '').trim();
  const body = String(input.body || '').replace(/[ \t]+/g, ' ').trim();
  const kind = KINDS.some(([k]) => k === input.kind) ? input.kind : 'note';
  const due = day(input.follow_up_on);
  if (!client) return { error: 'No client chosen.' };
  if (!body) return { error: 'Write a line about what happened or what’s needed.' };
  if (due && !/^\d{4}-\d{2}-\d{2}$/.test(due)) return { error: 'The follow-up date isn’t a date.' };
  if (due && today && due < today) return { error: 'The follow-up date is in the past.' };
  // When it happened: a local date-time from the form ("2026-10-08T10:32"), never in the future; default now.
  let happened = null;
  if (input.happened_at) {
    const d = new Date(input.happened_at);
    if (Number.isNaN(d.getTime())) return { error: 'When it happened isn’t a date and time.' };
    if (input.now && d.getTime() > new Date(input.now).getTime() + 5 * 60000) return { error: 'When it happened is in the future.' };
    happened = d.toISOString();
  }
  const mins = input.duration_min === '' || input.duration_min == null ? null : Math.round(Number(input.duration_min));
  if (mins != null && (!Number.isFinite(mins) || mins < 0 || mins > 1440)) return { error: 'How long should be minutes, e.g. 15.' };
  const direction = ['in', 'out'].includes(input.direction) && ['call', 'email'].includes(kind) ? input.direction : '';
  return { row: { client_name: client, kind, body: body.slice(0, 2000), contact_id: input.contact_id ? Number(input.contact_id) : null,
    contact_name: String(input.contact_name || '').trim(), follow_up_on: due || null,
    ...(happened ? { happened_at: happened } : {}), duration_min: mins || null, direction } };
}

/** This client's activity, newest first; open follow-ups (soonest first) separately. */
export function timeline(all, clientName) {
  const mine = (all || []).filter(a => sameClient(a.client_name, clientName));
  const open = mine.filter(a => a.follow_up_on && !a.follow_up_done_at).sort((a, b) => day(a.follow_up_on).localeCompare(day(b.follow_up_on)));
  const when = a => String(a.happened_at || a.created_at || '');
  const items = mine.slice().sort((a, b) => when(b).localeCompare(when(a)));
  return { open, items };
}

/** "15 min", "1 h 5 min" (calls and meetings). */
export function durationText(m) {
  const n = Number(m);
  if (!n) return '';
  return n < 60 ? `${n} min` : `${Math.floor(n / 60)} h${n % 60 ? ` ${n % 60} min` : ''}`;
}

/** "today", "tomorrow", "in 3 days", "2 days overdue". */
export function dueText(due, today) {
  const n = daysBetween(today, day(due));
  if (n === 0) return 'today';
  if (n === 1) return 'tomorrow';
  if (n > 1) return `in ${n} days`;
  return `${-n} day${n === -1 ? '' : 's'} overdue`;
}

/** Follow-ups due by today (not done), soonest first, with how late they are: for Overview › Today. */
export function dueFollowUps(all, today) {
  return (all || []).filter(a => a.follow_up_on && !a.follow_up_done_at && day(a.follow_up_on) <= today)
    .map(a => ({ ...a, late: daysBetween(day(a.follow_up_on), today) }))
    .sort((a, b) => day(a.follow_up_on).localeCompare(day(b.follow_up_on)) || String(a.client_name).localeCompare(String(b.client_name)));
}

/** When the client was last in touch (a call, email, meeting or visit), for the client header. */
export function lastContact(items) {
  const when = a => String(a.happened_at || a.created_at || '');
  const t = (items || []).filter(a => a.kind !== 'note').sort((a, b) => when(b).localeCompare(when(a)))[0];
  return t ? { kind: t.kind, at: day(when(t)), by: t.created_by || '', with: t.contact_name || '' } : null;
}
