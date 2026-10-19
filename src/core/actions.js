/* Next best action (Philip, 19 Oct 2026: "ok now lets build the next best action list"): one ranked list on Overview › Today of what
   to do now to make or protect money, from what Gecko HQ already knows. Protect first (a server or PC down, a machine with no backup),
   then money by value (leaks to bill, money owed, deals to chase, SSA to renew, products the support notes say they need, PCs to
   replace). Each item has one button to where it's done. No AI, no cost. Pure: no window. Tests: tests/actions.mjs.
   Design: docs/superpowers/specs/2026-10-19-next-best-action-design.md */

import { productLabel } from './reconcile.js';

export const CHASE_DAYS = 7;          // a Proposed deal untouched this long: chase it
export const SSA_RENEW_HOURS = 2;     // SSA hours left at or below this: renew (Overview's "running low")
export const SSA_BLOCK_GBP = 650;     // an SSA block (Phase 4 renewal: n × SSA at £650)
// For ranking only, never shown as a price: a deal or product with no value of its own, and the PCs line (which is always there
// while Windows 10 lasts, so it sits mid-list rather than on top every day).
export const UNPRICED_SCORE = 300;
export const PCS_SCORE = 2000;

const r2 = n => Math.round((Number(n) || 0) * 100) / 100;
const plural = (n, one, many = one + 's') => `${n} ${n === 1 ? one : many}`;
const daysBetween = (a, b) => Math.floor((new Date(b + 'T12:00:00Z') - new Date(String(a).slice(0, 10) + 'T12:00:00Z')) / 86400000);
/** Year-equivalent value, for ranking only: a monthly amount counts twelve times, money owed one and a half (it's cash now). */
const worth = v => (!v ? 0 : v.per === 'month' ? v.gbp * 12 : v.per === 'owed' ? v.gbp * 1.5 : v.gbp);

/**
 * → [{ key, group: 'protect'|'money', kind, client, title, why, value: { gbp, per: 'month'|'once'|'owed' } | null, go, score }],
 * protect first, then by value. Every source is optional; a missing one is simply not used (the page names what wasn't checked).
 *   devices:   GeckoMonitor.devices() items (red only)          coverage: GeckoMonitor.coverage() red [{ client, what, text }]
 *   reconcile: reconcileAll() result                           overdue:  xero_invoices rows (AUTHORISED, amount due, due date)
 *   opps:      opportunities rows                              ssa:      [{ name, remaining, archived }]
 *   insights:  latest client_insights (kind evidence) per client  products: opportunity_products
 *   upgrades:  core/upgrades.js upgrades().clients             dates:    core/dates.js comingUp()
 *   seo:       core/seo.js siteState() per SEO site
 *   today:     YYYY-MM-DD
 */
export function nextActions({ devices = [], coverage = [], reconcile = null, overdue = [], opps = [], ssa = [], insights = [], products = [], upgrades = [], dates = [], seo = [], today }) {
  const out = [];
  const add = a => out.push({ value: null, ...a });
  const product = key => products.find(p => p.key === key) || null;
  const open = (client, key) => opps.some(o => o.client_name === client && o.product_key === key && ['idea', 'proposed', 'won'].includes(o.status));

  // Protect: down now, or not backed up.
  for (const d of devices.filter(x => x.level === 'red')) add({ key: `down:${d.agent}`, group: 'protect', kind: 'down', client: d.customer,
    title: d.server ? `Server ${d.machine} is offline` : `${d.machine} isn’t on this morning`, why: d.user ? `Usually on; ${d.user}’s machine.` : 'Usually on by now.',
    go: 'devices', score: d.server ? 3e6 : 2e6 });
  for (const c of coverage) add({ key: `cover:${c.client}:${c.what}`, group: 'protect', kind: 'cover', client: c.client,
    title: `${c.what}: ${c.text}`, why: 'Not protected: a quote for backup is the fix.', go: 'coverage', score: 1e6 });

  // Money: bill what's in use and not billed (Reconcile's leaks, a month at a time).
  for (const c of reconcile?.clients || []) {
    if (c.own) continue;
    for (const r of c.rows.filter(x => (x.state === 'leak' || x.state === 'unbilled') && x.gapGbp > 0)) add({ key: `leak:${c.name}:${r.product}`, group: 'money', kind: 'leak',
      client: c.name, title: `Bill ${c.name}: ${productLabel(r.product)}`, why: r.text, value: { gbp: r2(r.gapGbp), per: 'month' }, go: 'reconcile' });
    if (c.belowCost) add({ key: `below:${c.name}`, group: 'money', kind: 'below', client: c.name, title: `${c.name} costs more than they pay`,
      why: `Losing ${'£' + Math.abs(c.margin).toFixed(2)} a month on Atera, Acronis, Webroot and Keeper.`, value: { gbp: r2(-c.margin), per: 'month' }, go: 'reconcile' });
  }

  // Money owed and overdue, per client.
  const late = new Map();
  for (const i of overdue.filter(x => x.status === 'AUTHORISED' && Number(x.amount_due) > 0 && x.due_date && String(x.due_date) < today)) {
    const e = late.get(i.contact_name) || { gbp: 0, n: 0, oldest: i.due_date };
    e.gbp += Number(i.amount_due); e.n++; if (String(i.due_date) < String(e.oldest)) e.oldest = i.due_date;
    late.set(i.contact_name, e);
  }
  for (const [name, e] of late) add({ key: `owed:${name}`, group: 'money', kind: 'owed', client: name, title: `Chase ${name}: ${plural(e.n, 'invoice')} overdue`,
    why: `Oldest due ${daysBetween(e.oldest, today)} days ago. Nudge drafts a friendly reminder.`, value: { gbp: r2(e.gbp), per: 'owed' }, go: 'jobs:owed' });

  // Deals: proposed and gone quiet, or a follow-up that's due.
  for (const o of opps.filter(x => x.status === 'proposed')) {
    const quiet = daysBetween(o.modified_at, today), due = o.follow_up_on && String(o.follow_up_on) <= today;
    if (quiet < CHASE_DAYS && !due) continue;
    const v = Number(o.mrr) > 0 ? { gbp: r2(o.mrr), per: 'month' } : Number(o.one_off) > 0 ? { gbp: r2(o.one_off), per: 'once' } : null;
    add({ key: `chase:${o.id}`, group: 'money', kind: 'chase', client: o.client_name, title: `Chase ${o.title.replace(/\s+[—-]\s+.*$/, '')} with ${o.client_name}`,
      why: due ? `Follow-up due ${o.follow_up_on === today ? 'today' : `since ${o.follow_up_on}`}.` : `Proposed, nothing since ${quiet} days ago.`, value: v, go: `client:advice:${o.client_name}`,
      ...(v ? {} : { score: (Number(product(o.product_key)?.default_mrr) || 0) * 12 || UNPRICED_SCORE }) });
  }

  // SSA running out: the renewal.
  for (const s of ssa.filter(x => !x.archived && x.remaining != null && x.remaining <= SSA_RENEW_HOURS)) add({ key: `ssa:${s.name}`, group: 'money', kind: 'ssa',
    client: s.name, title: `Renew ${s.name}’s support hours`, why: s.remaining <= 0 ? `${r2(-s.remaining)} hours over.` : `${r2(s.remaining)} hours left.`,
    value: { gbp: SSA_BLOCK_GBP, per: 'once' }, go: 'timesheets:ssa' });

  // What we keep fixing: a product their own support notes point to, not yet in the pipeline.
  for (const ins of insights) for (const t of ins.data?.themes || []) {
    if (!t.product_key || open(ins.client_name, t.product_key)) continue;
    const p = product(t.product_key);
    if (!p || p.active === false) continue;
    add({ key: `evidence:${ins.client_name}:${t.product_key}`, group: 'money', kind: 'evidence', client: ins.client_name, title: `Offer ${p.name} to ${ins.client_name}`,
      why: `${t.theme}: ${plural(t.jobs, 'job')}, ${t.hours} hours of support. The email has the evidence.`,
      value: Number(p.default_mrr) > 0 ? { gbp: r2(p.default_mrr), per: 'month' } : null, go: `client:advice:${ins.client_name}`,
      ...(Number(p.default_mrr) > 0 ? {} : { score: UNPRICED_SCORE }) });
  }

  // PCs that can't get Windows security updates: replacements to sell, free upgrades to book. One line when several clients have them.
  const win = product('windows11'), each = Number(win?.default_one_off) || 0;
  const pcs = upgrades.filter(c => !c.own && !open(c.name, 'windows11')).map(c => ({ name: c.name,
    rep: (c.devices || []).filter(d => d.plan === 'replace').length, up: (c.devices || []).filter(d => d.plan === 'upgrade').length }))
    .filter(c => c.rep || c.up).sort((x, y) => y.rep + y.up - (x.rep + x.up) || x.name.localeCompare(y.name));
  if (pcs.length === 1) {
    const c = pcs[0];
    add({ key: `win:${c.name}`, group: 'money', kind: 'windows', client: c.name,
      title: c.rep ? `Quote ${plural(c.rep, 'new PC')} for ${c.name}` : `Book ${plural(c.up, 'free Windows 11 upgrade')} at ${c.name}`,
      why: [c.rep && `${plural(c.rep, 'PC')} too old for Windows 11`, c.up && `${plural(c.up, 'PC')} can upgrade free`].filter(Boolean).join('; ') + ': no security updates now.',
      value: c.rep && each ? { gbp: r2(c.rep * each), per: 'once' } : null, go: `client:advice:${c.name}`, ...(c.rep && each ? {} : { score: PCS_SCORE }) });
  } else if (pcs.length) {
    const n = pcs.reduce((t, c) => t + c.rep + c.up, 0);
    add({ key: 'win:all', group: 'money', kind: 'windows', client: '', title: `Quote new PCs and Windows 11 upgrades for ${pcs.length} clients`,
      why: `${plural(n, 'PC')} can’t get Windows security updates; most at ${pcs.slice(0, 3).map(c => `${c.name} (${c.rep + c.up})`).join(', ')}.`,
      go: 'upgrades', score: PCS_SCORE });
  }

  // Dates that come round (core/dates.js): the nearer, the higher. A domain we bill for that's about to lapse is protect.
  for (const d of dates) {
    const urgency = d.days <= 14 ? 3 : d.days <= 30 ? 2 : 1;
    add({ key: `date:${d.key}`, group: d.group, kind: d.kind, client: d.client, title: d.title, why: d.why, value: d.value, go: d.go,
      score: d.group === 'protect' ? 5e5 - d.days : (worth(d.value) || UNPRICED_SCORE) * urgency });
  }

  // SEO (core/seo.js): a site that's down or hidden from Google is protect; an active client with no work logged by the 15th earns the fee.
  for (const x of seo) {
    const red = x.findings.filter(f => f.level === 'red');
    if (red.length && x.site.status !== 'proposed') add({ key: `seo-problem:${x.site.id}`, group: 'protect', kind: 'seo', client: x.site.client_name,
      title: `${x.site.domain}: ${red[0].text}`, why: red[0].fix, go: 'seo', score: x.site.status === 'active' ? 8e5 : 3e5 });
    if (x.flags.includes('no-work')) add({ key: `seo-work:${x.site.id}`, group: 'money', kind: 'seo', client: x.site.client_name,
      title: `Do this month’s SEO for ${x.site.client_name}`, why: `Nothing logged for ${x.site.domain} since ${x.lastWork ? x.lastWork.done_on : 'it started'}. The fee is earned by the work.`,
      value: x.fee ? { gbp: x.fee, per: 'month' } : null, go: 'seo' });
  }

  for (const a of out) if (a.score == null) a.score = worth(a.value) || 50;
  return out.sort((x, y) => (x.group === y.group ? 0 : x.group === 'protect' ? -1 : 1) || y.score - x.score || x.client.localeCompare(y.client));
}

/** "£12.50 a month", "£650 one-off", "£1,240.00 owed". */
export function valueText(v) {
  if (!v) return '';
  const n = '£' + (Number.isInteger(v.gbp) ? String(v.gbp) : v.gbp.toFixed(2)).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return v.per === 'month' ? `${n} a month` : v.per === 'owed' ? `${n} owed` : `${n} one-off`;
}
