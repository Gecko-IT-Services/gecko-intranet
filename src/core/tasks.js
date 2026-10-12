/* Tasks: client promises and handing work over. Pure logic (no window). Tested in tests/tasks.mjs.
   Design: docs/superpowers/specs/2026-10-12-tasks-design.md */

import { PEOPLE } from './team.js';
import { dueText, addDays } from './activity.js';
import { sameClient } from './client.js';

export { PEOPLE };
export const TITLE_MAX = 140;
export const NOTE_MAX = 500;
export const RED_AFTER_DAYS = 7;   // the rule follow-ups used: more than a week overdue is red
export const LATER_SHOWN = 5;      // Later shows this many, then "Show all n"
export const DONE_DAYS = 30;       // how far back the Done list goes

const day = d => String(d || '').slice(0, 10);
const oneLine = s => String(s || '').replace(/\s+/g, ' ').trim();
const daysBetween = (a, b) => Math.round((Date.parse(b + 'T00:00:00Z') - Date.parse(a + 'T00:00:00Z')) / 86400000);
const byDue = (a, b) => day(a.due_on).localeCompare(day(b.due_on)) || (a.id || 0) - (b.id || 0);
const RANK = { red: 0, new: 1, amber: 2 };

/** 'Jack Morris' or 'jack@gecko-it.com' → 'Jack'; '' when it is nobody in PEOPLE. */
export const personOf = name => PEOPLE.find(p => oneLine(name).toLowerCase().startsWith(p.toLowerCase())) || '';

/** The first line of a client note, as a task title. */
export const titleFromNote = body => oneLine(String(body || '').split('\n').find(l => l.trim()) || '').slice(0, TITLE_MAX);

/** Given to someone else and not opened by them yet. */
export const isNew = t => !t.done_at && !t.seen_at && !!t.assigned_by && t.assigned_by !== t.assigned_to;

/** How late, whoever has seen it: 'red' more than a week overdue · 'amber' due today or overdue · '' later. */
export function lateness(t, today) {
  const late = daysBetween(day(t.due_on), today);
  return late > RED_AFTER_DAYS ? 'red' : late >= 0 ? 'amber' : '';
}

/** 'red' more than a week overdue · 'new' a handoff not opened yet · 'amber' due today or overdue · '' later. */
export function level(t, today) {
  const late = lateness(t, today);
  if (late === 'red') return 'red';
  return isNew(t) ? 'new' : late;
}

/** "2 days overdue", "today", "tomorrow", otherwise "Fri 16 Oct". */
export function dueLabel(due, today) {
  const k = day(due);
  if (k <= addDays(today, 1)) return dueText(k, today);
  return new Date(k + 'T00:00:00Z').toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' });
}

/**
 * Tidy what was typed. Returns { row } or { error }.
 * `prev` is the task being edited (null for a new one). A new task, or one whose person changed, is
 * handed over by `me`: seen straight away when it is their own, new to the other person otherwise.
 */
export function cleanTask(input, { me = '', today, now = new Date().toISOString(), prev = null } = {}) {
  const title = oneLine(input.title).slice(0, TITLE_MAX);
  const who = PEOPLE.includes(input.assigned_to) ? input.assigned_to : '';
  const due = day(input.due_on);
  if (!title) return { error: 'Write what needs doing.' };
  if (!who) return { error: 'Choose who it is for.' };
  if (!/^\d{4}-\d{2}-\d{2}$/.test(due)) return { error: 'Choose a due date.' };
  // An overdue task can still be edited; only a date newly set in the past is refused.
  if (due < today && (!prev || day(prev.due_on) !== due)) return { error: 'The due date is in the past.' };
  const row = { title, note: oneLine(input.note).slice(0, NOTE_MAX), client_name: oneLine(input.client_name), assigned_to: who, due_on: due };
  if (!prev || prev.assigned_to !== who) Object.assign(row, { assigned_by: me, seen_at: me && who !== me ? null : now });
  if (!prev) row.created_by = me;
  return { row };
}

/**
 * Open tasks for Overview › Today.
 * now: red, new handoffs, then due (each by date), every one with its `level`.
 * later: due after today and already seen. waiting: what `me` gave to someone else.
 * With `everyone` (or when `me` is nobody in PEOPLE) now and later hold both people's tasks and waiting is empty.
 */
export function groups(tasks, me, today, everyone = false) {
  const open = (tasks || []).filter(t => !t.done_at);
  const all = everyone || !me;
  const shown = (all ? open : open.filter(t => t.assigned_to === me)).map(t => ({ ...t, level: level(t, today) }));
  return {
    now: shown.filter(t => t.level).sort((a, b) => RANK[a.level] - RANK[b.level] || byDue(a, b)),
    later: shown.filter(t => !t.level).sort(byDue),
    waiting: all ? [] : open.filter(t => t.assigned_by === me && t.assigned_to !== me).sort(byDue)
  };
}

/** One client's open tasks, soonest first (the client page's Tasks panel). */
export function forClient(tasks, clientName) {
  return (tasks || []).filter(t => !t.done_at && t.client_name && sameClient(t.client_name, clientName)).sort(byDue);
}

/** Ticked in the last `days` days, newest first. */
export function doneRecently(tasks, today, days = DONE_DAYS) {
  const from = addDays(today, -days);
  return (tasks || []).filter(t => t.done_at && day(t.done_at) >= from).sort((a, b) => String(b.done_at).localeCompare(String(a.done_at)));
}
