# Sharper pipeline

Philip, 9 Oct 2026: third of the contacts/sales improvements. On winning: "Both, depending on the deal" (one-off part →
a Job; monthly part → set up the repeating invoice and service line).

## What changes (Opportunities › Pipeline)
- **Follow-up date** on every deal (edit: None · Tomorrow · Next week · In 2 weeks · In a month, or a date). Due or overdue
  shows on the deal ("Follow up 3 days overdue") and on Overview › Today ("Chase Cowan: VoxOne (1 day overdue)"; red after a week).
- **Quiet deals**: an open deal with no change for 14 days is flagged "Quiet 21 days" (not while a follow-up date is still
  to come); Overview lists them as info.
- **Board view** (List | Board, remembered per browser): Idea · Proposed · Won · Lost columns with count and £/mo; won and
  lost show the last 90 days. Cards move with Proposed → / Won / Lost; Details opens the deal in the list.
- **Won: next steps** on a won deal:
  - one-off part → **Create job** makes an Agreed job with the one-off value (once per deal: `jobs.source_ref = 'opp:<id>'`,
    linked back in `opportunities.job_id`);
  - monthly part → "Set up the monthly billing: a repeating invoice in Xero for £x/mo + VAT, and the service line in
    Profitability" with **Mark done** (`billing_set_up_at/by`). The portal doesn't create the repeating invoice: Xero
    repeating templates need the contact, items and schedule set by hand, and the scope is drafts-only.
  - Overview › Today: "n won deals to set up" for deals won in the last 60 days.
- Marking a deal Won says what's next and opens the Won list.

## Data
Migration adds `opportunities.follow_up_on`, `job_id` (→ jobs, set null on delete), `billing_set_up_at`, `billing_set_up_by`.
Logic `dealState`, `jobFromDeal`, `boardColumns` in `src/core/opportunities.js` (tests in `tests/opportunities.mjs`;
Overview items in `tests/overview.mjs`). The one deal already won before this shows its billing step once; Mark done clears it.
