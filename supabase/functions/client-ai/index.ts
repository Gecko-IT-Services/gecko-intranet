// AI read-outs for one client (Philip, 19 Oct 2026: "how else can we use AI in this tool… 1-3 i like very much"). Staff only; one call per
// click, no tools; each call logged with its cost in public.ai_email_log, under the same daily cap as the email writer.
//   kind 'evidence': "What we keep fixing": groups six months of timesheet notes into recurring themes, each with the catalogue
//   product that would stop it. The AI only groups entry ids; the job counts and hours are summed here from timesheet_entries, so
//   every figure can be checked. Saved in public.client_insights.
// Secret: ANTHROPIC_API_KEY. Optional: EMAIL_DAILY_LIMIT, AI_MODEL (default claude-sonnet-5-5).
// Design: docs/superpowers/specs/2026-10-19-what-we-keep-fixing-design.md
import { cors, json, sql, staffEmail } from '../_shared/xero.ts';

const MODEL = Deno.env.get('AI_MODEL') || 'claude-sonnet-5-5';
const DAILY_LIMIT = Number(Deno.env.get('EMAIL_DAILY_LIMIT') || 40);
const PRICES: Record<string, [number, number]> = { 'claude-haiku-5-5': [0.10, 0.50], 'claude-sonnet-5-5': [2, 10], 'claude-opus-5-5': [4, 20] };
const [PRICE_IN, PRICE_OUT] = PRICES[MODEL] || PRICES['claude-sonnet-5-5'];

const EVIDENCE = `You read the timesheet notes of a small UK IT support company (Gecko IT Services) for one of its clients, and find the
kinds of work that keep coming back. The result is evidence for a sales conversation: "we keep fixing X; product Y would stop most of it".

Group the entries into recurring themes. Rules:
- A theme needs at least 2 entries. Leave out one-offs, admin, licence changes, new starters/leavers and planned projects unless they
  genuinely recur.
- Each entry id in at most one theme. Use only ids you were given.
- "theme": a short plain name the client would recognise (e.g. "Suspicious and phishing emails", "Printer problems"). UK English.
- "product_key": the key of the one catalogue product that would genuinely prevent or greatly reduce this kind of work, or null.
  Never a product in "already_has". Don't stretch: if nothing in the catalogue fits, null.
- "client_line": one sentence Gecko could say to the client about this pattern and what the product would change. No numbers (Gecko
  adds the counts), no internal tool names (Atera, Acronis, Webroot), no blame, no em or en dashes.
- At most 6 themes, the most useful for selling first.
"how_they_are_set_up" is Gecko's background on the client: use it to understand the notes.

Reply with JSON only, no other text:
{"themes":[{"theme":"…","entry_ids":[1,2],"product_key":"…or null","client_line":"…"}]}`;

async function claude(system: string, user: unknown, maxTokens = 4000) {
  const key = (Deno.env.get('ANTHROPIC_API_KEY') || '').replace(/[\s"'‘’“”​-‍﻿]/g, '');
  if (!key) throw new Error('ANTHROPIC_API_KEY is not set in Supabase › Edge Functions › Secrets');
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'x-api-key': key, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
    body: JSON.stringify({ model: MODEL, max_tokens: maxTokens, system, messages: [{ role: 'user', content: JSON.stringify(user) }] })
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`Claude ${res.status}: ${body?.error?.message || 'no answer'}`);
  const text = (body.content || []).filter((c: any) => c.type === 'text').map((c: any) => c.text).join('');
  return { text, usage: body.usage || {}, stop: body.stop_reason || '' };
}

/** The first {...} in a reply (code fences and chatter ignored). */
export function jsonOf(text: string) {
  const t = String(text || '').replace(/```(?:json)?/g, '');
  const a = t.indexOf('{'), b = t.lastIndexOf('}');
  if (a < 0 || b <= a) return null;
  try { return JSON.parse(t.slice(a, b + 1)); } catch { return null; }
}

const undash = (t: string) => String(t || '').replace(/\s*[—–]\s*/g, ', ').trim();

async function evidence(input: any, email: string) {
  const client = String(input.client || '').trim();
  const entries = (Array.isArray(input.entries) ? input.entries : []).filter((e: any) => Number(e.id)).slice(0, 600);
  if (entries.length < 2) return { ok: false, error: 'Fewer than two timesheet entries in the last six months: nothing to find patterns in.' };
  const catalogue = (input.catalogue || []).map((p: any) => ({ key: String(p.key), name: String(p.name), pitch: String(p.pitch || '') }));
  const already = (input.already || []).map(String);
  const r = await claude(EVIDENCE, { client, how_they_are_set_up: String(input.note || '').slice(0, 8000), catalogue, already_has: already,
    entries: entries.map((e: any) => ({ id: Number(e.id), date: String(e.date || ''), note: String(e.text || '').slice(0, 400) })) });
  const parsed = jsonOf(r.text);
  if (!parsed?.themes) throw new Error(`The reply couldn't be read (stop: ${r.stop}; starts: ${r.text.slice(0, 120).replace(/\s+/g, ' ')})`);
  // The figures are ours: re-read each entry from the timesheets, each id used once, only ids that were sent.
  const sent = new Set(entries.map((e: any) => Number(e.id)));
  const rows = await sql`select id, entry_date, hours, coalesce(nullif(title, ''), work_description, '') as title from public.timesheet_entries
                         where id = any(${[...sent]}) and deleted_at is null and hours > 0`;
  const byId = new Map(rows.map((x: any) => [Number(x.id), x]));
  const used = new Set<number>();
  const keys = new Set(catalogue.map((p: any) => p.key));
  const themes = [];
  for (const t of parsed.themes.slice(0, 6)) {
    const ids = (t.entry_ids || []).map(Number).filter((id: number) => sent.has(id) && byId.has(id) && !used.has(id));
    if (ids.length < 2) continue;
    ids.forEach((id: number) => used.add(id));
    const list = ids.map((id: number) => byId.get(id)).sort((a: any, b: any) => String(b.entry_date).localeCompare(String(a.entry_date)));
    const hours = Math.round(list.reduce((s: number, x: any) => s + Number(x.hours || 0), 0) * 100) / 100;
    const product = t.product_key && keys.has(String(t.product_key)) && !already.includes(String(t.product_key)) ? String(t.product_key) : null;
    themes.push({ theme: undash(t.theme).slice(0, 80), product_key: product, client_line: undash(t.client_line).slice(0, 300), jobs: list.length, hours,
      from: String(list[list.length - 1].entry_date).slice(0, 10), to: String(list[0].entry_date).slice(0, 10), entry_ids: ids,
      examples: list.slice(0, 3).map((x: any) => String(x.title).slice(0, 120)) });
  }
  const cost = ((r.usage.input_tokens || 0) * PRICE_IN + (r.usage.output_tokens || 0) * PRICE_OUT) / 1e6;
  const dates = entries.map((e: any) => String(e.date || '')).filter(Boolean).sort();
  const data = { themes, entries: entries.length, costUsd: Math.round(cost * 10000) / 10000 };
  const [saved] = await sql`insert into public.client_insights (client_name, kind, data, period_from, period_to, model, created_by)
                            values (${client}, 'evidence', ${sql.json(data)}, ${dates[0] || null}, ${dates[dates.length - 1] || null}, ${MODEL}, ${email})
                            returning id, created_at, period_from, period_to`;
  await sql`insert into public.ai_email_log (client_name, kind, created_by, model, input_tokens, output_tokens, cost_usd)
            values (${client}, 'evidence', ${email}, ${MODEL}, ${r.usage.input_tokens || 0}, ${r.usage.output_tokens || 0}, ${cost})`;
  return { ok: true, insight: { ...saved, kind: 'evidence', client_name: client, data, model: MODEL } };
}

Deno.serve(async req => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  try {
    const email = await staffEmail(req);
    if (!email) return json({ error: 'Not allowed' }, 403);
    const input = await req.json().catch(() => ({}));
    const client = String(input.client || '').trim();
    if (!client || !['evidence'].includes(input.kind)) return json({ ok: false, error: 'Which client, and which kind?' }, 400);
    const [{ n }] = await sql`select count(*)::int as n from public.ai_email_log where created_at > now() - interval '1 day'`;
    if (n >= DAILY_LIMIT) return json({ ok: false, error: `Today's limit of ${DAILY_LIMIT} AI calls is reached (EMAIL_DAILY_LIMIT in Supabase secrets).` });
    try {
      return json(await evidence(input, email));
    } catch (err) {
      const message = String((err as Error).message || err).slice(0, 400);
      await sql`insert into public.ai_email_log (client_name, kind, created_by, model, ok, error) values (${client}, ${input.kind}, ${email}, ${MODEL}, false, ${message})`;
      return json({ ok: false, error: message });
    }
  } catch (err) {
    return json({ ok: false, error: String((err as Error).message || err) }, 500);
  }
});
