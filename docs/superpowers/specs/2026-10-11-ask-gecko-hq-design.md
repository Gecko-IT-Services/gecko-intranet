# Ask Gecko HQ

**Status: removed 11 Oct 2026.** Philip, on hearing it costs roughly 5–20p a question through the Anthropic API:
"I don't want that then, please remove that part unless there is a free version." There is no free API tier, and a
Claude subscription can't be used by the site. The button, dialog, Edge Function and `ask_log` table were removed;
the design below is kept for reference.

Philip, 11 Oct 2026: "build the Ask Gecko HQ box" (after asking whether Claude was worth having inside the app; the
answer was yes, narrowly: read only, drafts at most, key on the server).

## What it is
- **Ask Gecko HQ** at the foot of the sidebar (desktop) or **Ask** in the top bar (phone) opens a dialog. Type a
  question in plain English ("Who is close to running out of SSA hours?", "What did we do for Cowan last month?",
  "How much have we invoiced so far this month?"); the answer is a few lines with client names linked to their pages.
  Follow-up questions keep the conversation (the last three exchanges). Five example questions on an empty dialog.
- Read only. It never writes, sends or changes anything; asked to, it says where in Gecko HQ to do it.

## How it works
- Edge Function `ask` (`supabase/functions/ask/index.ts`, Deno, `npm:@anthropic-ai/sdk`). Staff only (same check as
  the Xero functions: Microsoft sign-in + `public.staff`). Model `claude-opus-5-5`, effort medium, server-side refusal
  fallback (`fallbacks: "default"`), prompt caching on the fixed instructions + table list, at most 8 tool rounds.
- Tools (all read only):
  - `query_table`: rows from one of 17 listed tables (clients, services, SSA, timesheets, contacts, activity, profiles,
    domains, opportunities, products, prospects, jobs, Xero invoices and repeating invoices, VoIP dealer services,
    leave, mileage), at most 200 rows, with simple filters. It runs through the database API **as the person asking**,
    so row-level security applies and nothing else (the `private` schema with the Xero tokens, `staff`, logs) is reachable.
  - `ssa_balances`: every SSA client's purchased / used / remaining by Philip's rule (opening balance + changes since,
    exactly `balances()` in `src/core/timesheets.js`), never recalculated from history. Checked against the live data.
  - `timesheet_hours`: hours between two dates by client, engineer and work type (work only, no System entries).
  - `xero_sales`: net invoiced between two dates per contact (approved + paid, the same rule as Jobs › This month;
    VoIP Unlimited commission left out unless asked), drafts listed but not counted.
- The instructions say: look everything up, never guess; brief, British English, £ to two decimals; client names in
  `[[double brackets]]` (the page turns those into links); SSA from `ssa_balances` only; Xero is the source of truth.
- The answer is escaped before the few marks (links, **bold**, lists) become HTML (`src/core/ask.js`, `tests/ask.mjs`),
  so nothing in an answer can inject markup.
- Every question is logged in `public.ask_log` (who, question, answer, tool calls, tokens, time; staff read only).
  A daily cap (150 questions per rolling 24 hours, `ASK_DAILY_LIMIT` secret to change) stops a runaway bill.

## Setting it up (Philip)
1. console.anthropic.com → API keys → Create key (name it "Gecko HQ"). Billing: add a card / credit there.
2. Supabase › Edge Functions › Secrets → `ANTHROPIC_API_KEY` = the key.
3. The function is deployed from the repo after merge (like the Xero ones). Until the key is set, the dialog says so.

## Cost and data
- Roughly 5–20p a question at Opus 5.5 prices ($4 / $20 per million tokens in / out), depending on how much it reads;
  `ask_log` records the tokens so the real figure can be checked after the first week.
- The question and the rows Claude reads are sent to Anthropic's API to produce the answer. Philip to check Anthropic's
  current commercial terms and Gecko's privacy notice before relying on it for client data.

## Failure states
- No key: "Ask Gecko HQ isn't switched on yet…" (red box, never an empty answer). Key refused, rate limited, Claude down:
  each named. A tool error goes back to Claude as an error so it can say what it couldn't find. Daily cap: says so.
- Claude declines (refusal) after the fallback: "Sorry, I can't answer that one."

## Not done / rejected
- No writes, drafts or emails from here (the quote builder and statement email will own their own drafts).
- No free SQL: the model never writes SQL; fixed queries for sums, the database API (RLS) for everything else.
- The profit feed, Graph mail and SharePoint are not searched (slow and large); Xero tables cover revenue.
- Streaming the answer: not needed at a few lines; the dialog shows "Looking it up…".
