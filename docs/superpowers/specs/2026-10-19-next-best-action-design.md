# Do next: the next best actions (19 Oct 2026)

## Why
Philip: "ok now lets build the next best action list". What to do today to make or protect money was spread over Coverage, Reconcile,
Upgrades, the pipeline, SSA and Owed to us. One ranked list on Overview › Today answers it. No AI, no running cost.

## What it does
- **Do next** card at the top of Today's left column (above Needs attention): the top six, Show all for the rest; each row has the
  client, why, what it's worth and **Open →** to where it's done (the client's Upgrades & advice for anything to sell or chase).
- **Protect first**: a server or PC not on this morning (Devices, red), anything Coverage marks red (no backup).
- **Then money by value**, ranked by a year-equivalent (a month ×12, money owed ×1.5 as it's cash now, one-off as is):
  - Reconcile leaks (in use, not billed) and clients costing more than they pay, £ a month.
  - Overdue Xero invoices per client, £ owed (Nudge on Owed to us).
  - Proposed deals quiet for 7+ days or with a follow-up due.
  - SSA at 2 hours or less: the £650 renewal.
  - "What we keep fixing" themes whose product isn't in the pipeline: offer it, with the evidence.
  - PCs that can't get Windows security updates: one line for all clients (one per client when there's only one), opening
    Monitoring › Upgrades; ranked mid-list (it's there every day while Windows 10 lasts).
  - With no price of their own, a deal or product ranks by the catalogue's usual monthly value, or a modest default; never shown.
- Overview hands over what it already has (SSA balances, Devices and Coverage results); the card reads Reconcile (its new
  `snapshot()`), Xero, the pipeline, insights, the catalogue and Atera itself, at most every ten minutes. A source that fails is
  named under the card ("Not checked: …"), never shown as nothing to do.
- Logic `src/core/actions.js` (`nextActions`, tests `tests/actions.mjs`); card `src/sections/actions.js` (`window.GeckoActions`).

## Not done
- Dismissing or snoozing an item (it goes when the cause goes: billed, paid, chased, renewed).
- Idea-stage deals and prospects (Opportunities › Chase has them).
