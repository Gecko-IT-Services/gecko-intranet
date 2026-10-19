# AI-written client emails, with how each client is set up

Philip, 19 Oct 2026, after a test "IT at a glance" email for Cowans: "we need to have a free note section… to give emails such as
this context, because with this context that email would be different", then "it's just important that we explain in our own words
each client and how they are set up so that when emails… get composed you have proper context". Offered the no-cost route (notes +
item status steering templates) or AI; **he chose AI**, which reverses the 11 Oct "no paid AI" decision (Ask Gecko HQ) for this use.

## What it does

Client page › Upgrades & advice:
- **How <client> is set up, in our words**: one free-text description per client (`client_notes.setup`, up to 8,000 characters),
  private to Gecko: people, sites, systems, history, what's agreed, the tone to use, what not to raise. Saved with Save.
- **Write advice email with AI** (the ticked items) and **Write "IT at a glance" with AI** (what they have, how it's protected and
  backed up, good news, then the recommendations). The result shows in the preview, editable in place; the subject is editable;
  **Draft email in Outlook** as before. **Back to the plain version** returns to the template email (no AI, no cost).

## How (Edge Function `email-writer`)

One call to Claude per email (`EMAIL_MODEL`, default claude-haiku-5-5 since 19 Oct; it was claude-sonnet-5-5), no tools, forced to return `{ subject, html }`; the html is
cut down to p/h3/ul/ol/li/strong/em/br with no attributes before it reaches the page. Staff only. Every email is logged in
`ai_email_log` (who, client, kind, tokens, estimated $ at `EMAIL_PRICE_IN`/`EMAIL_PRICE_OUT`), under `EMAIL_DAILY_LIMIT` (40) a day.
Secret: `ANTHROPIC_API_KEY` (Philip creates it at console.anthropic.com, with a monthly spend limit there).

What Claude is given (`summaryFacts` / `adviceFacts` in core/advice.js, tests in tests/advice.mjs): only what the client may be told.
Counts that would expose our own gaps are never passed (devices missing antivirus; a backup that failed or is late: only backups good
within 3 days are told), nor billing, prices we pay, margins or tool names. Email set-up (SPF/DKIM/DMARC, filtering) is read from
public DNS in the browser. The rules (system prompt) say: facts only, the setup note shapes tone and content and wins where it says
something was agreed, never quote the note, UK English, warm and plain, no pressure, quote prices only as given.

Cost: the Cowans test on Sonnet 5.5 was 3,468 tokens in / 3,045 out, about $0.037 (3p; the log said $0.056 because it priced at the
older $3/$15). On Haiku 5.5 ($0.10/$0.50 per million) the same email is about $0.002. Philip, 19 Oct: "lets try Haiku 5.5 as the main
model, lets see how good it is"; if the writing isn't good enough, set the secret `EMAIL_MODEL` to claude-sonnet-5-5. The log now
prices each email at its own model's rate.

Also from the Cowans test: Windows 11 on a processor Microsoft doesn't support (Sage PC, i7-4771, 21H2) is now **Replace** in Upgrades,
not "update"; user names like `AzureAD\ChrisWyeth` read "Chris Wyeth".

## Rejected / later

- Writing the notes for every client automatically: the point is Gecko's own words.
- Sending from Gecko HQ: drafts only.
- A client-page summary of the notes elsewhere (Summary tab): later, if useful.

## Humanizer rules (19 Oct)

Philip: "can you use a humanizer skill with these emails?" His humanizer skill (Wikipedia's "Signs of AI writing") can't run inside the
Edge Function, so its rules that matter for a short client email are in the writer's instructions: no em/en dashes, no AI vocabulary
list, plain is/has verbs, no habitual threes, no "not only… but", no bolded bullet labels, no filler or stock openers/closers, no
puffery, varied sentence length, contractions, sentence-case headings, and a self-check before answering. As a safety net the function
replaces any em/en dash left in the subject or body (a dash between numbers becomes "to"). The key is also cleaned of pasted spaces and
quotes and must start sk-ant- (the first two runs failed with 401 invalid x-api-key).

## Rewrite with the updated notes (19 Oct)

Philip: "if I see something not right in that email I will add to the context note box and the preview should adjust?" The preview
doesn't rewrite as you type (each rewrite is a paid call). Instead, once an AI email is showing, editing the setup note shows a banner
over the preview, "Your notes have changed since this was written", with **Rewrite with the updated notes** (same kind of email, the
note saved first). One-off wording fixes are still made by editing the preview itself (free).
