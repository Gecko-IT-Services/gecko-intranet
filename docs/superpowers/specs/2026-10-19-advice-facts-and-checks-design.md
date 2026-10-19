# Upgrades & advice: what the AI is told, machines left out, and checking what comes back (19 Oct 2026)

## Why
Three test emails to Cowans (Haiku, then Sonnet) had holes a customer would spot: Teams backup offered when Teams is backed up,
"antivirus on all of them" (Webroot covers 17 of 22), out-of-date Office wording, the Windows 7 TimFram PC both kept and replaced,
an invented comparison. Most came from Gecko HQ (facts cut off at 1,000 rows, a yes/no where a count was needed, a topic that could
only be unticked whole), not the model. Philip asked for all three fixes: "yes please build all three".

Two principles from Philip while it was built:
- The setup note is **background**: "i wanted it to know what each client has, how it operates… so when an email gets sent it bears
  what has been written in mind". It shouldn't have to carry "don't do X" instructions, so leaving a machine out is a tick, not a note.
- It is **a sales tool**: "i want to be using this to sell gaps in the product range". Accuracy is what makes the pitch hold up.

## What it does
1. **Machines can be left out one by one.** Every machine under a Devices or Protection topic has its own tick. Unticked = left out
   of every email to that client (remembered in `client_notes.left_out`), shown struck through so it can be ticked back. A topic
   with all its machines left out drops out; its count is redone ("3 computers" → "2 computers"). The writer is told
   `leaveAlone` and never recommends anything for them (it may still mention them in an overview). `leaveOut()`.
2. **What the AI will be told**, above the write buttons: a one-line summary (selling N · computers · antivirus x of y · M365
   backup · recommendations) that opens to every fact: Selling (the products and prices ticked, first), Computers, Antivirus
   (the true count, for Philip; the email is only told "in place" or "on every computer"), Nightly backups, Microsoft 365
   backup (covered / not), Email, From Gecko, Not seen for a month, Recommendations, Left out. `factsPanel()`.
3. **Gecko HQ checks the email** (no AI, no cost) and lists problems above the preview, re-checked as Philip edits: internal tool
   names and money words (red); antivirus "every/all" when it isn't (red); a left-out machine named; a machine it wasn't told
   about; a number not in the facts or the note ("21", "four computers"); "every/all" claims about protection; offering backup
   for something already backed up; "not urgent" in a sales email; long dashes and AI-tell words. `checkEmail()`.
   Tuned on the real Sonnet email: it flags exactly its two problems (Teams, "none of this is urgent") and nothing else.
- Also: changing ticks or left-out machines after an AI email marks it out of date (Rewrite) instead of throwing it away, and
  edits typed into the preview survive a redraw.
- Writer (`email-writer`): told it's a sales email (case made for this client, what they gain, risk stated plainly, one clear
  next step, never "not urgent", no hard sell); the note described as background; `leaveAlone` respected.

## Not done
- No AI second pass to review the email (cost, and the checks catch the known holes deterministically).
- Product gaps (catalogue findings) can't be left out item by item: they are reasons, not machines; untick the product.
