# Timesheets: one-click SSA renewal — Design

Date: 2026-10-07. Asked for by Philip: renewing an SSA client took four manual steps across
SharePoint, Power Automate and Xero.

## Before
1. In SharePoint, add a Timesheets entry: Engineer "System", Hours −10 (−20 for two blocks),
   "Credit - 10 Hours".
2. Wait for the **Update Client Balances** flow (trigger: item created on Timesheets, polls
   every minute) to add it to `HoursUsed` on the Clients list.
3. Press **Send Timesheet** on the Clients list: flow **Create Timesheets Table Email** emails the
   client from support@gecko-it.com (cc Jack, Philip) and saves an HTML copy to
   `Gecko Docs/clients/<Client Folder>/`.
4. Raise the invoice in Xero by hand: item `SSA`, "Software Support Agreement - 10 hours",
   £650 per block, account 214, reference "Renewal".

## Design
**Renew…** on each SSA card (Timesheets › SSA Dashboard) opens a dialog: pick 1–5 blocks of 10
hours, see who the email goes to and what Xero will need, then **Renew & send**:

1. Creates the System credit entry, worded as the hand-typed ones. **The portal never writes
   `HoursUsed`** (Philip's rule, 7 Oct 2026; see `2026-10-07-ssa-double-count-design.md`).
2. Polls the Clients row every 10 s until the flow has applied the credit (a drop of more than
   half the credit, so a 15-minute entry logged in the same minute does not stall it). Up to 3 min.
3. Builds the email exactly as the flow does (same greeting, card, balance badge, columns) and
   sends it **as support@gecko-it.com** via `/users/support@…/sendMail`, cc Jack and Philip,
   saved to the mailbox's Sent Items.
4. Saves the same HTML to `Gecko Docs/clients/<Client Folder>/Timesheet Summary - <Client> -
   yyyy-MM-dd - HHmm.html`, as the flow does.
5. Shows the Xero invoice lines with **Copy details** and **Open Xero**.

Pure logic (entry selection, email HTML, Xero lines, file name) is in `src/core/ssa-renewal.js`,
tested in `tests/ssa-renewal.mjs` against Cowan's real 30 Sep 2026 email.

### Which entries the email lists
The flow lists entries dated on or after the **previous** credit (it takes the two latest credits
and starts from the older). It compares a UK date with a UTC timestamp, so in summer it drops
entries on the same day as the previous credit and in winter it includes the previous credit
itself. The portal: entries dated after the previous credit, or on the same day with a higher ID.
Archived entries are included (the flow does not filter them).

### Wording change
The flow describes every credit as "Credit – 10 hours (SSA renewal)", even a 20-hour one (Cowan,
30 Sep: "+20.00 … Credit – 10 hours"). The portal uses the real figure.

## Permissions
- Sending as support@ needs **Mail.Send.Shared**, requested by this button only through
  `graphFetch(path, { scopes, interactive: true })`; not added to `CONFIG.SCOPES`. Each user
  approves it once in a Microsoft pop-up.
- The sender also needs **Send As** on the support mailbox in Exchange. The flow already sends
  "From: support@" as whoever presses its button, so Philip and Jack are expected to have it.
  If not, the step fails with the exact admin-centre path to add it.

## Failure states (none look like success or like an empty state)
- No email on the Clients row → Renew is disabled, with the column to fill in.
- Credit could not be created → back to the form; nothing written.
- Credit added but not applied within 3 min → no email (it would show the old balance);
  "Try sending again" checks the balance has moved before sending.
- Email refused (Send As, blocked pop-up, Graph error) → the step shows why; the credit stays;
  "Try sending again" sends without adding a second credit.
- Copy to Gecko Docs failed → reported, not retried; the email has gone.
- Second renewal within 15 min for the same client → confirm first (double-click / two people).

## Non-goals
- Creating the invoice in Xero. The Xero connection available is read-only and the site is
  public (no keys). Deferred: a Xero app connection run outside the site, like the feed.
- Changing or switching off the Power Automate flows. SharePoint's Send Timesheet still works.
- Any change to existing balances or entries.
