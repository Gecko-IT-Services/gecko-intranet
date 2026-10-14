# Opportunities Chase view Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Opportunities › Pipeline opens on a Chase view (live deals to act on) and Could sell (untouched catalogue ideas grouped by product), with honest figures.

**Architecture:** One pure function `chaseView` in `src/core/opportunities.js` decides Chase vs Could sell and the order; `pipelineTotals` gains Proposed totals. `src/sections/opportunities.js` draws a third pipeline view from it, reusing the board's deal pop-up, `draftEmail`, `moveDeal`, `makeJob`.

**Tech Stack:** Plain ES modules, no build; tests are `node tests/*.mjs` with `node:assert/strict`.

## Global Constraints
- Spec: `docs/superpowers/specs/2026-10-14-opportunities-chase-design.md`.
- Every rendered value through `escapeHtml`; section CSS scoped under `#section-opportunities`; existing tokens and `.btn`/`.badge` only; sentence case.
- No schema change. Board and List views unchanged. `show(tab)` / `open(id)` unchanged.
- Check at 390px, light and dark, in the `hq-preview` harness.

---

### Task 1: `chaseView` and Proposed totals

**Files:** Modify `src/core/opportunities.js` (after `boardColumns`; `pipelineTotals`), `tests/opportunities.mjs`.

**Produces:** `chaseView(opps, products, today) → { chase: opp[], couldSell: { product, items: opp[] }[] }`; `pipelineTotals(...)` adds `proposedCount`, `proposedMrr`, `proposedOneOff`.

- [ ] Step 1: tests (append to `tests/opportunities.mjs`, import `chaseView`, update the `pipelineTotals` deepEqual with `proposedCount: 1, proposedMrr: 45.5, proposedOneOff: 150`):

```js
// — Chase and Could sell (14 Oct) —
const P = [{ key: 'voxone_mig', name: 'VoIP Exchange → VoxOne' }, { key: 'hornet', name: 'Hornetsecurity' }];
const D = '2026-10-14';
const opp = (id, o) => ({ id, client_name: 'C' + id, status: 'idea', mrr: 0, one_off: 0, next_step: '', follow_up_on: null, modified_at: '2026-10-13T09:00:00Z', ...o });
const cv = chaseView([
  opp(1, { product_key: 'voxone_mig', mrr: 4, client_name: 'Waterside' }),
  opp(2, { product_key: 'voxone_mig', mrr: 4, client_name: 'Freeston' }),
  opp(3, { product_key: 'hornet', client_name: 'Snowskool' }),
  opp(4, { product_key: 'hornet', next_step: 'Call Chris' }),                     // acted on → chase
  opp(5, { one_off: 650 }),                                                      // a conversation → chase
  opp(6, { product_key: 'gone' }),                                               // product removed → chase
  opp(7, { status: 'proposed', mrr: 30 }),
  opp(8, { status: 'proposed', mrr: 4, follow_up_on: '2026-10-11' }),            // 3 days late → first
  opp(9, { status: 'proposed', mrr: 99, modified_at: '2026-09-01T09:00:00Z' }),  // quiet → after set-up
  opp(10, { status: 'won', mrr: 10, closed_at: '2026-10-10T09:00:00Z' }),        // billing to set up
  opp(11, { status: 'won', mrr: 10, billing_set_up_at: '2026-10-11T09:00:00Z' }),// done → nowhere
  opp(12, { status: 'lost', mrr: 50 })                                           // nowhere
], P, D);
assert.deepEqual(cv.chase.map(o => o.id), [8, 10, 9, 7, 5, 4, 6], 'late, to set up, quiet, then by value');
assert.deepEqual(cv.couldSell.map(g => [g.product.key, g.items.map(o => o.client_name)]),
  [['voxone_mig', ['Freeston', 'Waterside']], ['hornet', ['Snowskool']]],
  'grouped by product, most clients first, clients by name');
assert.deepEqual(chaseView([], P, D), { chase: [], couldSell: [] });
```

- [ ] Step 2: `node tests/opportunities.mjs` → fails (`chaseView` not exported).
- [ ] Step 3: implement:

```js
/**
 * Pipeline › Chase (14 Oct, 2026-10-14-opportunities-chase-design.md). Chase: deals that need a person —
 * proposed; ideas with no (known) product, a one-off, a next step or a follow-up date; won still to set up.
 * Order: follow-up due (latest first), won to set up, quiet (quietest first), then £/month, one-off.
 * Could sell: the other ideas (promoted gaps nobody has acted on), by product, most clients first.
 */
export function chaseView(opps, products, today) {
  const byKey = new Map(products.map(p => [p.key, p]));
  const chase = [], groups = new Map();
  for (const o of opps) {
    const product = byKey.get(o.product_key);
    const acted = !product || Number(o.one_off) > 0 || String(o.next_step || '').trim() || dayKey(o.follow_up_on);
    if (o.status === 'idea' && !acted) {
      if (!groups.has(product.key)) groups.set(product.key, { product, items: [] });
      groups.get(product.key).items.push(o);
      continue;
    }
    const st = dealState(o, today);
    if (st.open || st.needsJob || st.needsBilling) chase.push({ o, st });
  }
  const rank = ({ st }) => (st.followUpDue ? 0 : st.needsJob || st.needsBilling ? 1 : st.stale ? 2 : 3);
  const n = v => Number(v) || 0;
  chase.sort((a, b) => rank(a) - rank(b) || b.st.followUpLate - a.st.followUpLate || b.st.stale - a.st.stale
    || n(b.o.mrr) - n(a.o.mrr) || n(b.o.one_off) - n(a.o.one_off));
  const couldSell = [...groups.values()]
    .map(g => ({ ...g, items: g.items.sort((a, b) => String(a.client_name).localeCompare(String(b.client_name))) }))
    .sort((a, b) => b.items.length - a.items.length || String(a.product.name).localeCompare(String(b.product.name)));
  return { chase: chase.map(c => c.o), couldSell };
}
```

and in `pipelineTotals` add `const proposed = opps.filter(o => o.status === 'proposed');` and return `proposedCount: proposed.length, proposedMrr: sum(proposed, 'mrr'), proposedOneOff: sum(proposed, 'one_off')`.

- [ ] Step 4: `node tests/opportunities.mjs` → passes; full suite `for t in tests/*.mjs; do node $t || echo FAIL $t; done`.
- [ ] Step 5: commit "Opportunities: chaseView splits deals to chase from ideas to pitch".

### Task 2: the Chase view, figures and group drafts

**Files:** Modify `src/sections/opportunities.js` (state `view`, `init`, `renderKpis`, `drawDialog`, `draftEmail`, `pipelineHtml`, `onClick`, `onKeydown`), `src/styles/opportunities.css`.

**Consumes:** `chaseView`, `pipelineTotals` from Task 1.

- [ ] Step 1: `OPP.view` default `'chase'`; `init` reads `gecko.opp.view` as one of `chase|board|list`, else `chase`. Toggle: `Chase | Board | List`.
- [ ] Step 2: `drawDialog` shows the pop-up when `OPP.view !== 'list'` (Chase reuses it). In `pipelineHtml`, before the board branch:

```js
if (OPP.view === 'chase') {
  const sel = OPP.opps.find(o => o.id === OPP.selected);
  OPP.dealHtml = sel ? deal(sel) : '';
  return `<div class="opp-pipe-head">${toggle}</div>${chaseHtml(flags)}`;
}
```

`chaseHtml(flags)` draws the Chase rows (client, product with vendor mark, value, next step, `flags(o)` + To set up badge, buttons: Draft email / Proposed / Won / Lost on open deals, Create job / Mark done on won) — the row itself is `data-opp-act="pick"` (plain client name, no link inside a clickable row) — and the Could sell groups (product, price `£unit_price per <unit>` or `£default_mrr/mo each`, N clients, N need a price, chips that pick, `Draft emails (N)` with `data-opp-act="draftall" data-product`). Empty Chase: "Nothing to chase."; empty Could sell: "Nothing waiting. Add ideas from Gaps."
- [ ] Step 3: `draftEmail` returns `true` when the draft was made, `false` when not; its failure toast names the client. `draftall` runs `draftEmail` over the group's ids one after another and stops at the first `false`.
- [ ] Step 4: figures: Proposed (`proposedMrr`/mo, deals · one-off) · Could sell (N ideas, N products · N need a price) · Won this month.
- [ ] Step 5: Enter/Space on a Chase row picks it (extend the `onKeydown` selector to `.opp-chase-row`).
- [ ] Step 6: CSS for `.opp-chase`, `.opp-chase-row`, `.opp-sell-group`, chips; one column under the `oppwrap` 560px container query.
- [ ] Step 7: full suite; preview (`hq-preview`) light, dark, 390px; commit "Opportunities opens on Chase: what to follow up, then what to pitch".

### Task 3: docs and PR
- [ ] CLAUDE.md Opportunities bullet: Pipeline opens on Chase (Chase | Board | List), `chaseView`. Push, PR titled in plain English.
