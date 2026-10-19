# What we keep fixing (19 Oct 2026)

## Why
Philip, asked how else AI could help: "1-3 i like very much". This is 3: real evidence sells better than a catalogue paragraph.
"We've spent 4.5 hours of your support time on suspicious emails since June" is the strongest reason a client has to buy Hornetsecurity.

## What it does
- Client page › Upgrades & advice opens with **What we keep fixing**: the client's last six months of timesheet notes (SSA clients;
  System entries, deleted and zero-hour entries left out) read by Claude Sonnet 5.5 on request ("Find patterns in N notes with AI",
  about 1p), grouped into up to six recurring themes, each with a client-facing line and the catalogue product that would stop it.
- **The AI only groups entry ids.** The Edge Function (`client-ai`, kind `evidence`) re-reads those entries from `timesheet_entries`
  and adds up jobs, hours and the date range itself; an id it wasn't sent, or one used twice, is dropped; a theme needs two jobs; a
  product must be in the catalogue and not one the client already has. Money/time figures reconcile (Philip's rule).
- Kept in `client_insights` (kind evidence), so it's paid for once; **Read again** when there's more to read.
- A theme's product: on the list → its email gets the evidence ("evidence added"); not on the list → **Add <product>**.
- The evidence reaches the writer as `recommendations[].evidence` (and `supportPatterns` for IT at a glance); the writer is told it's
  the strongest reason and to use its figures exactly. The facts panel's Selling line says when evidence is attached; Gecko HQ's
  check knows the figures.

## Not done (yet)
- Atera alerts as a second source (they come by email today; the Atera API's alerts could be synced).
- Running it for every client in one go (cost is small, but on request keeps it deliberate).

## Failure states
- Table missing before the migration: the box shows the button; a run says what failed. Reply unreadable: the error says what came back.
