// Writes a client email with Claude from facts Gecko HQ already holds plus the client's context note. Staff only; one call per
// email, no tools; every email logged with its cost in public.ai_email_log, under a daily cap. Returns { subject, html } for the
// page to show, edit and save to Outlook Drafts (nothing is sent from here).
// Secret: ANTHROPIC_API_KEY. Optional: EMAIL_DAILY_LIMIT (default 40), EMAIL_MODEL (default claude-sonnet-5-5), EMAIL_PRICE_IN / EMAIL_PRICE_OUT ($ per million tokens).
// Design: docs/superpowers/specs/2026-10-19-ai-client-emails-design.md
import { cors, json, sql, staffEmail } from '../_shared/xero.ts';

// Sonnet 5.5 (Philip, 19 Oct 2026, after trying Haiku 5.5: "these emails will go to the customer… it needs to be impressive not hole
// ridden"). Haiku wrote well but contradicted itself and ignored given facts; at ~3.5p an email the better judgement is worth it.
const MODEL = Deno.env.get('EMAIL_MODEL') || 'claude-sonnet-5-5';
const DAILY_LIMIT = Number(Deno.env.get('EMAIL_DAILY_LIMIT') || 40);
// $ per million tokens in / out (Anthropic's list prices, Oct 2026), so ai_email_log shows what each email really cost.
const PRICES: Record<string, [number, number]> = { 'claude-haiku-5-5': [0.10, 0.50], 'claude-sonnet-5-5': [2, 10], 'claude-opus-5-5': [4, 20] };
const PRICE_IN = Number(Deno.env.get('EMAIL_PRICE_IN') || (PRICES[MODEL] || PRICES['claude-sonnet-5-5'])[0]);
const PRICE_OUT = Number(Deno.env.get('EMAIL_PRICE_OUT') || (PRICES[MODEL] || PRICES['claude-sonnet-5-5'])[1]);

const RULES = `You write emails from Gecko IT Services, a small UK managed IT provider, to the main contact at one of its clients.
The person sending is named in "sender". Write as them, in the first person, warm and plain, like a trusted local IT partner. UK English.

Use ONLY the facts given. Never invent devices, numbers, dates, prices or products. If a fact isn't given, leave it out.
"how_they_are_set_up" is Gecko's own private description of this client, in their words: their people, sites, systems, history,
what they have, how they operate, the feel of the place. It is background, there so you know them (Philip, 19 Oct 2026: "i wanted
it to know what each client has, how it operates… so when an email gets sent it bears what has been written in mind"). Read it first
and let it shape what you say and how, so the email sounds like it comes from someone who knows them; if it does say to leave
something out, respect that; never quote it or mention that notes exist. Where it
disagrees with the facts about something that was planned or agreed, trust it. Never repeat its instructions to the client (don't
write "we're leaving X alone" or "nothing is proposed for X": just leave X out).

Never mention: what Gecko pays suppliers, margins or billing; internal tools by name (Atera, Acronis, Webroot, Supabase, Gecko HQ);
anything Gecko got wrong (failed or late backups, missed devices); other clients. Product names a client buys (Microsoft 365,
Hornetsecurity, Keeper) are fine. Quote a price only when the facts give one, exactly as given, plus VAT.

This is a sales email (Philip, 19 Oct 2026: "i want to be using this to sell gaps in the product range"): the aim is that they say yes
to the recommendations. Make each one's case for this client in particular: their people, machines and way of working from the note
and the facts; lead with what they gain; one or two sentences on the risk of leaving it, stated plainly. Where something is
time-sensitive (no security updates now) say so; never call the recommendations "not urgent". No scare tactics, no hard sell.
A recommendation may carry "evidence": what Gecko has actually spent this client's support time on, which the product would stop.
It is the strongest reason they have to say yes: use it, with its figures exactly as given (jobs, hours, months). In an "IT at a
glance" email, facts.supportPatterns may be mentioned briefly as what we've been helping with.
Be specific: name the computers and people the facts name. Keep it short enough to be read in a couple of minutes.
End with one clear next step (a short call, or a reply to book it in), that we'll plan it around them and quote before any cost.
Kind "advice": the ticked recommendations only. Kind "summary": an "IT at a glance" overview (what they have, how it's protected and
backed up, good news worth saying) followed by the recommendations.
Kind "review": a quarterly IT review, sent ahead of a short review meeting (Philip, 19 Oct 2026: "what we did, what changed, what's at
risk, what to propose"). Sections with <h3> headings, in this order: the last three months (facts.lastThreeMonths: jobs and hours as
given, the kinds of work, and a few highlights picked from its examples, in plain words, nothing internal; facts.supportPatterns for
what kept coming back); their IT now (as in "IT at a glance", briefly); worth keeping an eye on (risks only from the facts, stated
plainly); what we'd recommend (the recommendations, with evidence and prices as given). End by suggesting a short review call or visit
and asking when suits. It can be longer than an email, but keep it to what can be read in five minutes.

HTML only with <p>, <h3>, <ul>, <ol>, <li>, <strong>, <em>, <br>. No styles, no images, no signature block beyond a short sign-off with
the sender's first name (their email signature is added automatically).

Write like a person, not a chatbot (Philip's "humanizer" rules, from Wikipedia's "Signs of AI writing", 19 Oct 2026):
- No em dashes or en dashes at all. Use a full stop, a comma, a colon or brackets instead.
- None of these words: crucial, delve, enhance, foster, garner, highlight (as a verb), intricate, key (as an adjective), landscape,
  pivotal, seamless, showcase, tapestry, testament, underscore, vibrant, robust, leverage, streamline, additionally, moreover.
- Plain verbs: "is", "has", "runs", "needs". Not "serves as", "stands as", "boasts", "features", "offers".
- Don't group things in threes by habit; give as many as there really are.
- No "not only… but also", no "it's not just X, it's Y", no clipped add-ons like "no fuss" or "no downtime" tacked on the end.
- No bolded label at the start of every bullet ("Security: …"). Bullets are short plain sentences or names. Bold sparingly, if at all.
- No filler ("in order to", "due to the fact that", "it's worth noting", "it is important to note") and no stacked hedging.
- No stock openers or closers: not "I hope this email finds you well", "I wanted to reach out", "Exciting times ahead", "the future
  looks bright", "don't hesitate to", "please feel free to". One "I hope all is well" is fine if it suits the note's tone.
- No puffing up ("vital role", "game-changer", "peace of mind" more than once, "take your IT to the next level"), no sycophancy.
- Vary sentence length. Short and long. Use contractions (we'll, you're, it's) as people do in email.
- Sentence-case headings, no emojis, straight quotes.
Before you answer, check it twice:
1. Against the note and the facts: never recommend anything for a machine in facts.leaveAlone (Gecko chose not to raise it; you may
   still mention it in an overview); drop every recommendation for a device or system the note says to leave alone or keep (wherever
   it appears, including inside a list of computers to replace); never offer something the facts or the note say they already have
   (for example parts of Microsoft 365 that are already backed up); never say something covers "every" or "all" computers unless the
   facts say so; no device may be both kept and replaced.
2. Reread it and ask "what in this sounds AI-written?", and fix it.`;

const ALLOWED = new Set(['p', 'h3', 'ul', 'ol', 'li', 'strong', 'em', 'br', 'b', 'i']);
/** Only the allowed tags, with no attributes; everything else dropped (its text kept). */
export function clean(html: string) {
  return String(html || '')
    .replace(/<\s*(script|style)[^>]*>[\s\S]*?<\/\s*\1\s*>/gi, '')
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/<\s*(\/?)\s*([a-z0-9]+)[^>]*>/gi, (_, close, tag) => (ALLOWED.has(tag.toLowerCase()) ? `<${close}${tag.toLowerCase()}>` : ''))
    .trim();
}

/**
 * Claude's reply → { subject, html }. Asked for "SUBJECT: …", a line "---", then the HTML body (JSON broke on long HTML, 19 Oct).
 * Tolerant: code fences dropped; a JSON reply still read; with no separator, the first line is the subject if it says so.
 */
export function parseEmail(text: string) {
  const t = String(text || '').replace(/```(?:html|json)?/g, '').trim();
  if (t.startsWith('{')) { try { const o = JSON.parse(t); if (o.html) return { subject: String(o.subject || ''), html: String(o.html) }; } catch { /* not JSON after all */ } }
  const m = t.match(/^\s*SUBJECT:\s*(.+?)\s*\n\s*-{3,}\s*\n([\s\S]+)$/i) || t.match(/^\s*SUBJECT:\s*(.+?)\s*\n([\s\S]+)$/i);
  if (m) return { subject: m[1].trim(), html: m[2].trim() };
  return { subject: '', html: /<p[\s>]/i.test(t) ? t : '' };
}

async function write(input: any) {
  const key = (Deno.env.get('ANTHROPIC_API_KEY') || '').replace(/[\s"'\u2018\u2019\u201C\u201D\u200B-\u200D\uFEFF]/g, '');   // pasted keys pick up spaces and quotes
  if (key && !/^sk-ant-/.test(key)) throw new Error('ANTHROPIC_API_KEY doesn’t start with sk-ant-: copy the key again from the Claude Console (API keys)');
  if (!key) throw new Error('ANTHROPIC_API_KEY is not set in Supabase › Edge Functions › Secrets');
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'x-api-key': key, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
    body: JSON.stringify({
      // A plain-text reply shape (forcing a tool isn’t supported on Sonnet 5.5, and JSON broke on long HTML, 19 Oct).
      model: MODEL, max_tokens: 8000,   // room for its thinking as well as a long email
      system: RULES + '\n\nReply in exactly this shape and nothing else:\nSUBJECT: <a short, specific, friendly subject>\n---\n<the email body as HTML>',
      messages: [{ role: 'user', content: JSON.stringify({
        kind: input.kind, client: input.client, to_first_name: input.firstName || '', sender: input.sender || '',
        how_they_are_set_up: input.note || '', facts: input.facts || {} }) }]
    })
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`Claude ${res.status}: ${body?.error?.message || 'no answer'}`);
  const text = (body.content || []).filter((c: any) => c.type === 'text').map((c: any) => c.text).join('');
  const out = parseEmail(text);
  if (!out.html) throw new Error(`Claude's reply couldn't be read as an email (stop: ${body.stop_reason || '?'}; starts: ${text.slice(0, 160).replace(/\s+/g, ' ')})`);
  // Safety net for the one rule that is easiest to check: no em or en dashes reach the client.
  const undash = (t: string) => t.replace(/(\d)\s*[\u2013\u2014]\s*(?=[£$]?\d)/g, '$1 to ').replace(/\s*[\u2014\u2013]\s*/g, ', ').replace(/,\s*,/g, ',');
  return { subject: undash(String(out.subject || '')).slice(0, 200), html: undash(clean(out.html)), usage: body.usage || {} };
}

Deno.serve(async req => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  try {
    const email = await staffEmail(req);
    if (!email) return json({ error: 'Not allowed' }, 403);
    const input = await req.json().catch(() => ({}));
    const client = String(input.client || '').trim();
    if (!client || !['advice', 'summary', 'review'].includes(input.kind)) return json({ ok: false, error: 'Which client, and which kind of email?' }, 400);
    const [{ n }] = await sql`select count(*)::int as n from public.ai_email_log where created_at > now() - interval '1 day'`;
    if (n >= DAILY_LIMIT) return json({ ok: false, error: `Today's limit of ${DAILY_LIMIT} AI emails is reached (EMAIL_DAILY_LIMIT in Supabase secrets).` });
    try {
      const r = await write(input);
      const cost = ((r.usage.input_tokens || 0) * PRICE_IN + (r.usage.output_tokens || 0) * PRICE_OUT) / 1e6;
      await sql`insert into public.ai_email_log (client_name, kind, created_by, model, input_tokens, output_tokens, cost_usd)
                values (${client}, ${input.kind}, ${email}, ${MODEL}, ${r.usage.input_tokens || 0}, ${r.usage.output_tokens || 0}, ${cost})`;
      // A quarterly review is kept with the client (client_insights), so the last one can be looked back on.
      if (input.kind === 'review') await sql`insert into public.client_insights (client_name, kind, data, period_from, period_to, model, created_by)
        values (${client}, 'review', ${sql.json({ subject: r.subject, html: r.html, costUsd: cost })}, ${input.facts?.lastThreeMonths?.from || null},
                ${input.facts?.lastThreeMonths?.to || null}, ${MODEL}, ${email})`;
      return json({ ok: true, subject: r.subject, html: r.html, costUsd: Math.round(cost * 10000) / 10000 });
    } catch (err) {
      const message = String((err as Error).message || err).slice(0, 400);
      await sql`insert into public.ai_email_log (client_name, kind, created_by, model, ok, error) values (${client}, ${input.kind}, ${email}, ${MODEL}, false, ${message})`;
      return json({ ok: false, error: message });
    }
  } catch (err) {
    return json({ ok: false, error: String((err as Error).message || err) }, 500);
  }
});
