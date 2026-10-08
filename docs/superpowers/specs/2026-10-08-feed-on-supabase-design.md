# Profitability feed on Supabase — design

Status: built 8 Oct 2026 (Jack); site switched to the row the same day after Philip's first run (steps 1–3 done). Phase 6 of `2026-10-07-supabase-migration-design.md`.

## What moves
`Gecko Dashboard Data/profitability-feed.json` (SharePoint Documents) becomes one row in
`public.profit_feed` (`id = 1`, `data jsonb`). The JSON is stored unchanged, so
`validateFeed` and everything in `src/core/profit-feed.js` work as before. Version 1 stays
version 1.

Readers: Profitability (`prfLoadFeed`) and Opportunities (`readFeed`) now share one loader,
`fetchProfitFeed()` in `index.html`, which reads the file or the row depending on
`CONFIG.DATA_BACKEND.feed`. No row yet means "missing", exactly like no file.

## Who writes it
Only Philip's scheduled Claude task ("Gecko Dashboard profitability feed", 06:47 daily).
It writes through the **Supabase connector** in Philip's Claude account, so no Supabase
key goes in the task prompt or the site. The site only reads it: the RLS policy is
`select` for staff, with no insert or update policy.

Step to add to the task prompt, after it has built and checked the feed and before (or
instead of) uploading the file:

> Save the finished feed to Supabase project `nkobrqzsogtyxriqqwnq` with the Supabase
> connector's execute_sql tool, as one statement, with the feed JSON between the `$feed$`
> markers exactly as built:
>
> `insert into public.profit_feed (id, data) values (1, $feed$<the feed JSON>$feed$::jsonb)
> on conflict (id) do update set data = excluded.data;`
>
> Then run `select data->>'generatedAt' from public.profit_feed where id = 1;` and check it
> matches the feed's generatedAt. If either fails, say so in the run summary.

The feed is about 30 KB today, comfortably inside one statement.

## Switching over (one step at a time)
1. Merge this. The Supabase GitHub integration creates the table. The site still reads
   the file (`feed: 'sharepoint'`).
2. Philip connects the Supabase connector in his Claude account and adds the step above to
   the task, keeping the file upload. Run the task once by hand.
3. Check the row matches the file (same `generatedAt`), then set
   `CONFIG.DATA_BACKEND.feed = 'supabase'`.
4. After a week of good runs, remove the file upload from the task. The file is then
   stale; archive it with the other SharePoint leftovers.

## Rejected
- **A Supabase secret key in the task prompt.** It bypasses RLS on every table and would
  sit in plain text in a prompt.
- **A table per feed section.** Nothing queries inside the feed. Splitting it would mean
  rewriting `profit-feed.js` and the task's output for no reader that needs it.
- **The site copying the file into Supabase on load.** SharePoint would still be the
  source, so nothing would actually move.

## Failure states
- No row: same "not set up yet" box as a missing file, naming the table.
- Database error or no sign-in: the "Could not read the automatic feed" box, with the
  error. It never looks like an empty feed.
- Task stops writing: `isStale` flags it from `generatedAt`, the same as before.
