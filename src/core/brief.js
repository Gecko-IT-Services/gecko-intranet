/* The Monday brief (Philip, 19 Oct 2026: "now lets build the monday brief"; chose "From Gecko HQ": made in Outlook Drafts the first time
   Overview opens on a Monday, or by a button any day; never sent). Figures only, from what Overview already holds: Do next, last
   week against the week before, the week ahead, what needs a look. No AI. Pure: no window. Tests: tests/brief.mjs.
   Design: docs/superpowers/specs/2026-10-19-monday-brief-design.md */

import { valueText } from './actions.js';

const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const gbp = n => '£' + (Number(n) || 0).toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
const hrs = n => `${Math.round((Number(n) || 0) * 100) / 100}h`;
const plural = (n, one, many = one + 's') => `${n} ${n === 1 ? one : many}`;
const dayName = d => new Date(String(d).slice(0, 10) + 'T12:00:00Z').toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' });
/** "up £120.00 on the week before", "same as the week before". */
const versus = (now, before, fmt) => (now === before ? 'same as the week before' : `${now > before ? 'up' : 'down'} ${fmt(Math.abs(now - before))} on the week before`);

/** The Monday of the week `today` is in (YYYY-MM-DD): the brief's key, one per person per week. */
export function weekKey(today) {
  const d = new Date(today + 'T12:00:00Z');
  d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7));
  return d.toISOString().slice(0, 10);
}

/**
 * → { subject, html }. today: YYYY-MM-DD; first: the reader's first name; actions: core/actions.js nextActions(); last: core/review.js
 * weekReview() for last week; ahead: core/overview.js thisWeek() for this week; attention: core/overview.js attention() items (tasks
 * and info left out here); missing: sources that weren't read (named, so a short brief never passes for a quiet week); url: Gecko HQ.
 */
export function mondayBrief({ today, first = '', actions = [], dates = [], last = null, ahead = null, attention = [], missing = [], url = '' }) {
  const parts = [];
  const section = (title, items) => { if (items.length) parts.push(`<h3>${esc(title)}</h3><ul>${items.map(i => `<li>${i}</li>`).join('')}</ul>`); };

  const top = actions.slice(0, 8);
  section(`Do next${actions.length > top.length ? ` (top ${top.length} of ${actions.length})` : ''}`, top.map(a =>
    `<strong>${esc(a.title)}</strong>${a.value ? ` · ${esc(valueText(a.value))}` : ''}<br>${esc(a.why)}`));

  if (last) {
    const items = [];
    if (last.invoiced) items.push(`Invoiced ${gbp(last.invoiced.week)} (${plural(last.invoiced.count, 'invoice')}), ${versus(last.invoiced.week, last.invoiced.last, gbp)}.`);
    const people = Object.entries(last.hours || {}).filter(([, h]) => h.week || h.last);
    if (people.length) items.push(`Hours logged: ${people.map(([p, h]) => `${p} ${hrs(h.week)}`).join(', ')} (the week before: ${people.map(([p, h]) => `${p} ${hrs(h.last)}`).join(', ')}).`);
    if (last.pipeline) {
      const p = last.pipeline;
      if (p.won.length) items.push(`Won ${plural(p.won.length, 'deal')}${p.wonMrr ? `, ${gbp(p.wonMrr)} a month` : ''}: ${esc(p.won.map(o => o.client_name).join(', '))}.`);
      if (p.added.length) items.push(`${plural(p.added.length, 'new deal')} in the pipeline.`);
      if (p.lost.length) items.push(`Lost ${plural(p.lost.length, 'deal')}: ${esc(p.lost.map(o => o.client_name).join(', '))}.`);
    }
    if (last.jobs?.invoiced.length) items.push(`${plural(last.jobs.invoiced.length, 'job')} invoiced.`);
    if (last.nudges?.length) items.push(`${plural(last.nudges.length, 'payment reminder')} drafted.`);
    section(`Last week (${dayName(last.start)} to ${dayName(last.end)})`, items);
  }

  if (ahead) {
    const items = [];
    for (const l of ahead.away || []) items.push(`${esc(l.person || 'Someone')} away ${l.now ? 'now' : `from ${dayName(l.start)}`}${l.end && l.end !== l.start ? ` to ${dayName(l.end)}` : ''}.`);
    for (const j of ahead.jobsDue || []) items.push(`Job due ${dayName(j.target_date)}: ${esc(j.title || '')}${j.client_name ? ` (${esc(j.client_name)})` : ''}.`);
    if (ahead.goingOut?.count) items.push(`${plural(ahead.goingOut.count, 'repeating invoice')} going out, ${gbp(ahead.goingOut.value)}.`);
    section('This week', items);
  }

  // Dates that come round (core/dates.js), soonest first, with how long is left.
  section('Coming up', dates.slice(0, 12).map(d => `<strong>${esc(dayName(d.date))}</strong> (${d.days === 0 ? 'today' : d.days === 1 ? 'tomorrow' : `in ${d.days} days`}): ${esc(d.title)}${d.value ? ` · ${esc(valueText(d.value))}` : ''}`));

  section('Needs a look', attention.filter(i => !i.task && i.level !== 'info').slice(0, 8).map(i => `${i.level === 'red' ? '<strong>' : ''}${esc(i.title)}${i.level === 'red' ? '</strong>' : ''}${i.detail ? `: ${esc(i.detail)}` : ''}`));

  const hello = `<p>Good morning${first ? ` ${esc(first)}` : ''}. Here’s the week from Gecko HQ.${url ? ` <a href="${esc(url)}">Open Gecko HQ</a>.` : ''}</p>`;
  const body = parts.length ? parts.join('') : '<p>Nothing to chase, bill or protect, and nothing needs a look.</p>';
  const gaps = missing.length ? `<p><em>Not checked: ${esc(missing.join(', '))}.</em></p>` : '';
  return { subject: `Gecko HQ: the week of ${dayName(weekKey(today))}`, html: hello + body + gaps + '<p>Made by Gecko HQ. Only you can see this draft.</p>' };
}
