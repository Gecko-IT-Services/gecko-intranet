import assert from 'node:assert/strict';
import {
  recurringMoves, monthSeries, concentration, monthMoney,
  logGrid, workKind, weeklyKinds, supportShare, typedShare, renewals, whitespace, DEPENDENCE
} from '../src/core/analytics.js';

const inv = (contact_name, invoice_date, sub_total, rep = 'r', status = 'AUTHORISED') =>
  ({ contact_name, invoice_date, sub_total, status, repeating_invoice_id: rep, invoice_number: `${contact_name}-${invoice_date}` });
const rep = (contact_name, next_date, sub_total, extra = {}) => ({ contact_name, next_date, sub_total, status: 'AUTHORISED', period: 1, unit: 'MONTHLY', ...extra });

// ─── recurringMoves: the sum must add up, and each move says what kind it is ───
{
  const invoices = [
    inv('Harbour', '2026-08-01', 100), inv('Annual Co', '2026-06-10', 600),
    inv('Harbour', '2026-09-01', 100), inv('Calder', '2026-09-03', 90), inv('Dovecote', '2026-09-05', 60), inv('Quarterly', '2026-09-07', 300),
    inv('Tern', '2026-09-08', 50),
    inv('Harbour', '2026-10-01', 135), inv('Wren', '2026-10-02', 310), inv('Annual Co', '2026-10-03', 600, 'r', 'PAID'),
    inv('Harbour', '2026-10-04', 999, ''),                      // one-off: never recurring
    inv('Harbour', '2026-10-05', 999, 'r', 'DRAFT'),            // drafts are not counted
    inv('Voip Unlimited', '2026-10-06', 613.5)                  // dealer commission is nobody's revenue
  ];
  const repeating = [
    rep('Calder', '2026-10-20', 40),                            // still to be raised this month, at less than before
    rep('Tern', '2026-10-25', 50),                              // still to come, unchanged: no move
    rep('Quarterly', '2026-12-07', 300, { period: 3 }),         // live, not due this month
    rep('Gone', '2026-10-09', 80, { status: 'DELETED' })
  ];
  const m = recurringMoves(invoices, repeating, { month: '2026-10' });
  assert.equal(m.from, '2026-09'); assert.equal(m.to, '2026-10');
  assert.equal(m.prev, 600); assert.equal(m.toCome, 90);
  assert.equal(m.now, 135 + 310 + 600 + 40 + 50);
  assert.equal(Math.round((m.prev + m.gSum - m.lSum) * 100), Math.round(m.now * 100), 'September + gained − lost = October');
  assert.deepEqual(m.gained.map(g => [g.name, g.v, g.kind]), [['Annual Co', 600, 'periodic'], ['Wren', 310, 'new'], ['Harbour', 35, 'more']]);
  assert.deepEqual(m.lost.map(g => [g.name, g.v, g.kind]), [['Quarterly', -300, 'notdue'], ['Dovecote', -60, 'left'], ['Calder', -50, 'less']]);
  assert.ok(!m.shares.some(s => /voip/i.test(s.name)));
  assert.equal(m.shares[0].name, 'Annual Co');

  const c = concentration(m.shares);
  assert.equal(c.total, m.now);
  assert.ok(Math.abs(c.rows.reduce((t, r) => t + r.share, 0) - 1) < 1e-9);
  assert.equal(c.over, c.rows.filter(r => r.share >= DEPENDENCE).length);
  assert.deepEqual(concentration([]), { total: 0, rows: [], top3: 0, over: 0 });

  // monthSeries starts at the first month with anything, and only the month in progress has "to come".
  const jobs = [{ status: 'to_invoice', value: 200, invoice_ref: '' }, { status: 'agreed', value: 70, target_date: '2026-10-28', invoice_ref: '' }];
  const s = monthSeries(invoices, repeating, jobs, { month: '2026-10', n: 12 });
  assert.deepEqual(s.map(x => x.month), ['2026-06', '2026-07', '2026-08', '2026-09', '2026-10']);
  assert.equal(s[3].recurring, 600); assert.equal(s[3].recToCome, 0);
  assert.equal(s[4].recurring, 1045); assert.equal(s[4].oneOff, 999); assert.equal(s[4].recToCome, 90); assert.equal(s[4].oneToCome, 270);
  assert.deepEqual(monthSeries([], [], [], { month: '2026-10' }), []);
}

// ─── monthMoney: Profitability's rules ───
{
  const clients = [{ id: '1', name: 'Kingdom' }, { id: '2', name: 'Technix' }];
  const match = n => clients.find(c => n.toLowerCase().startsWith(c.name.toLowerCase())) || null;
  const services = [
    { clientName: 'Kingdom', category: 'stack', cost: 8.14 }, { clientName: 'Kingdom', category: 'm365', cost: 30 },
    { clientName: 'Kingdom', category: 'hosting', cost: 5 }, { clientName: 'Technix', category: 'retainer', cost: 0 }
  ];
  const feed = {
    version: 1, generatedAt: '2026-10-10T06:47:00Z',
    xero: { months: { '2026-09': { 'Kingdom Ltd': 250, 'Technix': 215.9 }, '2026-10': { 'Kingdom Ltd': 189.82 } },
            recurring: { '2026-09': { 'Kingdom Ltd': 189.82, 'Technix': 215.9 }, '2026-10': { 'Kingdom Ltd': 189.82 } } },
    cspInvoices: [{ date: '2026-09-16', invoice: 'TD1', customers: [{ customer: 'Kingdom', cost: 33.72 }, { customer: 'Nobody Ltd', cost: 10 }] }],
    clook: { invoices: [{ date: '2026-09-02', invoice: 'CL1', lines: [{ item: 'Reseller plan', net: 29.99, shared: true }, { item: 'kingdom.co.uk', net: 4, client: 'Kingdom' }] }] }
  };
  const sep = monthMoney(feed, '2026-09', clients, services, match);
  const k = sep.rows[0];
  assert.equal(k.cost, 45.86, 'stack 8.14 + TD SYNNEX 33.72 + Clook 4; the typed m365 and hosting costs are not counted');
  assert.equal(k.recurring, 189.82); assert.equal(k.oneOff, 60.18); assert.equal(k.total, 250);
  assert.equal(sep.recurring, 405.72);
  assert.equal(sep.cost, 85.85, 'lines 8.14 + every supplier line 77.71 (shared and unassigned included)');
  assert.ok(Math.abs(sep.margin - (405.72 - 85.85) / 405.72) < 1e-9);
  assert.equal(sep.licenceIn, true);
  const oct = monthMoney(feed, '2026-10', clients, services, match);
  assert.equal(oct.licenceIn, false, 'no TD SYNNEX invoice dated in October yet');
  assert.equal(oct.rows[0].cost, 8.14);
  // A month the feed doesn't cover falls back to the typed lines and has no margin.
  const aug = monthMoney(feed, '2026-08', clients, services, match);
  assert.equal(aug.rows[0].cost, 43.14); assert.equal(aug.margin, null); assert.equal(aug.split, false);
}

// ─── logGrid ───
{
  const today = '2026-10-08';   // Thursday
  const entries = [
    { engineer: 'Philip', date: '2026-10-05', hours: 6, clientName: 'A' }, { engineer: 'Jack', date: '2026-10-05', hours: 2, clientName: 'A' },
    { engineer: 'Jack', date: '2026-10-05', hours: 3, clientName: 'B' },
    { engineer: 'Philip', date: '2026-10-06', hours: 5, clientName: 'A' },                     // Jack blank on Tuesday
    { engineer: 'Philip', date: '2026-10-07', hours: 4, clientName: 'A' },                     // Jack on leave Wednesday
    { engineer: 'System', date: '2026-10-07', hours: 10, clientName: 'A' }
  ];
  const leave = [{ person: 'Jack', start: '2026-10-07', end: '2026-10-07', status: 'Approved' }, { person: 'Jack', start: '2026-10-06', end: '2026-10-06', status: 'Pending' }];
  const g = logGrid(entries, leave, { today, weeks: 2 });
  assert.equal(g.start, '2026-09-28');
  const [philip, jack] = g.people;
  assert.deepEqual(jack.weeks[1].map(d => d.state), ['ok', 'blank', 'away', 'future', 'future']);
  assert.deepEqual(philip.weeks[1].map(d => d.state), ['ok', 'ok', 'ok', 'future', 'future']);
  assert.ok(philip.weeks[0].every(d => d.state === 'closed'), 'a weekday nobody logged is closed, not blank');
  assert.equal(jack.weeks[1][0].hours, 5); assert.equal(jack.weeks[1][0].top, 'B');
  assert.equal(g.blanks, 1); assert.equal(g.logged, 4);
  assert.equal(g.typical, 5); assert.deepEqual(g.cuts, [4, 5, 5], 'shade steps at the quartiles of the logged days: 4, 5, 5, 6');
}

// ─── weeklyKinds ───
{
  assert.equal(workKind('Remote Support'), 'support'); assert.equal(workKind('Onsite Support'), 'support');
  assert.equal(workKind('Project Work'), 'planned'); assert.equal(workKind('PC Set Up'), 'planned'); assert.equal(workKind('Maintenance'), 'planned');
  assert.equal(workKind('Misc'), 'other'); assert.equal(workKind(''), 'other');
  const rows = weeklyKinds([
    { engineer: 'Jack', date: '2026-10-05', hours: 3, workType: 'Remote Support' }, { engineer: 'Jack', date: '2026-10-06', hours: 1, workType: 'Project Work' },
    { engineer: 'Jack', date: '2026-09-29', hours: 2, workType: '' }, { engineer: 'Jack', date: '2026-09-01', hours: 9, workType: 'Misc' },
    { engineer: 'Jack', date: '2026-10-09', hours: 9, workType: 'Misc' }
  ], { today: '2026-10-08', weeks: 2 });
  assert.deepEqual(rows, [{ start: '2026-09-28', support: 0, planned: 0, other: 2, total: 2, untyped: 2 }, { start: '2026-10-05', support: 3, planned: 1, other: 0, total: 4, untyped: 0 }]);
  assert.equal(supportShare(rows), 0.5); assert.equal(supportShare([]), null);
  assert.ok(Math.abs(typedShare(rows) - 4 / 6) < 1e-9); assert.equal(typedShare([]), null);
}

// ─── renewals ───
{
  const r = renewals([
    { name: 'Later', remaining: 8, perMonth: 2, runsOut: '2027-01-08' }, { name: 'Over', remaining: -2.25, perMonth: 12, runsOut: null },
    { name: 'Soon', remaining: 3.5, perMonth: 8, runsOut: '2026-10-22' }, { name: 'Quiet', remaining: 6, perMonth: 0, runsOut: null }
  ], '2026-10-10');
  assert.deepEqual(r.rows.map(x => [x.name, x.state, x.days]), [['Over', 'over', 0], ['Soon', 'soon', 12], ['Later', 'ok', 90]]);
  assert.deepEqual(r.quiet, ['Quiet']);
  assert.deepEqual(r.byMonth, [{ month: '2026-10', count: 2, value: 1300 }, { month: '2027-01', count: 1, value: 650 }]);
}

// ─── whitespace ───
{
  const w = whitespace({
    products: [{ key: 'a', name: 'Alpha' }, { key: 'b', name: 'Beta' }, { key: 'c', name: 'Nobody' }],
    clients: [
      { name: 'Small', mrr: 50, cells: { a: { state: 'strong', mrr: 30 }, b: { state: 'has' } } },
      { name: 'Big', mrr: 900, cells: { a: { state: 'deal', mrr: 90 }, b: { state: 'maybe', mrr: null } } },
      { name: 'Mid', mrr: 300, cells: { a: { state: 'no' }, b: { state: 'some', mrr: 12.5 } } }
    ]
  });
  assert.deepEqual(w.rows.map(r => [r.name, r.gaps, r.total, r.pipeline, r.unpriced]), [['Beta', 2, 12.5, 0, 1], ['Alpha', 1, 30, 90, 0]], 'most room first, priced or not');
  assert.deepEqual(w.rows[1].tokens.map(t => [t.client, t.state]), [['Big', 'deal'], ['Mid', 'off'], ['Small', 'gap']]);
  assert.equal(w.total, 42.5); assert.equal(w.pipeline, 90); assert.equal(w.gaps, 3); assert.equal(w.unpriced, 1); assert.equal(w.clients, 3);
}

console.log('analytics: ok');
