// "Ask Gecko HQ": a plain-English question about Gecko's own data, answered by Claude with read-only tools.
// Staff only. Design: docs/superpowers/specs/2026-10-11-ask-gecko-hq-design.md
//
// Secret (Supabase › Edge Functions › Secrets): ANTHROPIC_API_KEY. Optional ASK_DAILY_LIMIT (default 150).
//
// Rules:
// - Read only. Claude can only call the tools below; none of them writes anything.
// - Questions Claude builds itself (query_table) run through the database API as the person asking, so the same
//   row-level security as the site applies and nothing outside the listed tables (tokens, the private schema) is reachable.
// - The fixed summaries (SSA balances, hours, sales) are SQL written here, with Claude only supplying dates/names.
// - SSA balances follow Philip's rule exactly as src/core/timesheets.js `balances` does: opening balance + changes since,
//   never recalculated from history.
// - Every question is logged in public.ask_log (who, question, answer, tokens), and there is a daily cap.

import Anthropic from 'npm:@anthropic-ai/sdk@0.128.0';
import { createClient } from 'npm:@supabase/supabase-js@2.116.0';
import { cors, json, PUBLISHABLE_KEY, sql, staffEmail } from '../_shared/xero.ts';

const MODEL = 'claude-opus-5-5';
const MAX_ROUNDS = 8;
const DAILY_LIMIT = Number(Deno.env.get('ASK_DAILY_LIMIT') || 150);

// Tables Claude may read with query_table, and what each holds. Columns are read from the database at start-up.
const TABLES: Record<string, string> = {
  gecko_clients: 'IT clients (title = client name, status Active/New/…, contract dates).',
  gecko_services: 'Service lines per client: what we sell monthly (sell/cost, category).',
  ssa_clients: 'Software Support Agreement (prepaid hours) clients. For balances use the ssa_balances tool, never these columns alone.',
  timesheet_entries: 'Time logged (client_id → ssa_clients.id, engineer, entry_date, hours, work description). For totals use timesheet_hours.',
  client_contacts: 'People at each client (name, role, email, phone, is_main).',
  client_activity: 'Calls, emails, meetings, notes logged per client, with follow-up dates.',
  client_profiles: 'Client address, postcode, office phone, website.',
  client_domains: 'Email/web domains per client.',
  opportunities: 'Sales pipeline: deals per client (status idea/proposed/won/lost, mrr = £/month, one_off).',
  opportunity_products: 'The product catalogue used for opportunities (prices, rules).',
  prospects: 'New business that is not a client yet (stage, £/month estimate, follow-up).',
  jobs: 'One-off client work with a value (status quoted/agreed/in_progress/to_invoice/invoiced/lost).',
  xero_invoices: 'Sales invoices from Xero (contact_name, invoice_number, invoice_date, status, sub_total = net, amount_due incl. VAT, line_items). For sales totals use xero_sales.',
  xero_repeating_invoices: 'Repeating invoice templates in Xero (next_date, sub_total).',
  voip_dealer_services: 'VoIP Unlimited dealer customers: services, contract state, fixed monthly commission to Gecko.',
  leave_requests: 'Holiday and leave (person, start_date, end_date, status).',
  mileage_journeys: 'Business mileage (driver, journey_date, miles, amount, claimed_date).'
};

const IDENT = /^[a-z_][a-z0-9_]*$/;
const OPS = ['eq', 'neq', 'gt', 'gte', 'lt', 'lte', 'ilike', 'is'] as const;

const tools: Anthropic.Tool[] = [
  {
    name: 'query_table',
    description: 'Read rows from one table (read only, at most 200 rows). Returns the rows and the total number that match. Use filters to narrow; ilike values use % as a wildcard.',
    strict: true,
    input_schema: {
      type: 'object',
      additionalProperties: false,
      required: ['table', 'columns', 'filters', 'order_by', 'descending', 'limit'],
      properties: {
        table: { type: 'string', enum: Object.keys(TABLES) },
        columns: { type: 'array', items: { type: 'string' }, description: 'Column names to return; empty for all.' },
        filters: {
          type: 'array',
          items: {
            type: 'object', additionalProperties: false, required: ['column', 'op', 'value'],
            properties: { column: { type: 'string' }, op: { type: 'string', enum: [...OPS] }, value: { type: 'string', description: 'Compared as text; for "is" use null, true or false.' } }
          }
        },
        order_by: { type: 'string', description: 'Column to sort by, or empty.' },
        descending: { type: 'boolean' },
        limit: { type: 'integer', description: '1 to 200.' }
      }
    }
  },
  {
    name: 'ssa_balances',
    description: 'Every SSA client’s prepaid hours: purchased, used and remaining, as Gecko HQ shows them. Archived clients are included and marked.',
    strict: true,
    input_schema: { type: 'object', additionalProperties: false, required: [], properties: {} }
  },
  {
    name: 'timesheet_hours',
    description: 'Hours logged between two dates (inclusive), totalled by client, engineer and work type, with the entries when there are 60 or fewer. Work only: System credits/adjustments are left out. Optional client name (partial match).',
    strict: true,
    input_schema: {
      type: 'object', additionalProperties: false, required: ['from', 'to', 'client'],
      properties: { from: { type: 'string', description: 'YYYY-MM-DD' }, to: { type: 'string', description: 'YYYY-MM-DD' }, client: { type: 'string', description: 'Part of the client name, or empty for all.' } }
    }
  },
  {
    name: 'xero_sales',
    description: 'Net sales invoiced in Xero between two dates (approved or paid invoices only, excluding VoIP Unlimited commission unless asked), totalled per contact, plus drafts listed separately.',
    strict: true,
    input_schema: {
      type: 'object', additionalProperties: false, required: ['from', 'to', 'include_commission'],
      properties: { from: { type: 'string', description: 'YYYY-MM-DD' }, to: { type: 'string', description: 'YYYY-MM-DD' }, include_commission: { type: 'boolean' } }
    }
  }
];

let schemaText = '';
async function describeTables() {
  if (schemaText) return schemaText;
  const rows = await sql`select table_name, string_agg(column_name, ', ' order by ordinal_position) cols
                           from information_schema.columns
                          where table_schema = 'public' and table_name = any(${Object.keys(TABLES)})
                          group by table_name order by table_name`;
  schemaText = rows.map(r => `- ${r.table_name}: ${TABLES[r.table_name as string]}\n  columns: ${r.cols}`).join('\n');
  return schemaText;
}

const SYSTEM = (schema: string) => `You answer questions from Philip and Jack Morris, who run Gecko IT Services (a small UK IT support company), about their own business data in Gecko HQ.

How to answer:
- Look the facts up with the tools; never guess a figure, name or date. If the data can't answer the question, say what is missing.
- Be brief and plain: a sentence or two, or a short list. British English, £ with two decimals, dates like 9 Oct 2026.
- Put every client name in double square brackets, exactly as the data spells it, e.g. [[Cowan Consultancy]]; the page turns those into links.
- Say what a figure covers (dates, approved invoices only, etc.) when it matters.
- You can only read. If asked to change, send or create something, say where in Gecko HQ to do it instead.
- SSA hours: always use ssa_balances for what a client has left; never work balances out from timesheet entries.
- Money: Xero is the source of truth for revenue. VoIP Unlimited commission is Gecko's income, not a client's.

Tables you can read with query_table:
${schema}`;

type Ctx = { db: ReturnType<typeof createClient> };

async function runTool(name: string, input: any, ctx: Ctx): Promise<unknown> {
  if (name === 'query_table') {
    const table = String(input.table);
    if (!(table in TABLES)) throw new Error(`Unknown table ${table}`);
    const cols = (input.columns || []).filter((c: string) => IDENT.test(c));
    let q: any = ctx.db.from(table).select(cols.length ? cols.join(',') : '*', { count: 'exact' });
    for (const f of input.filters || []) {
      if (!IDENT.test(f.column) || !OPS.includes(f.op)) throw new Error(`Bad filter on ${f.column}`);
      const v = f.op === 'is' ? (f.value === 'null' ? null : f.value === 'true') : f.value;
      q = q[f.op](f.column, v);
    }
    if (input.order_by && IDENT.test(input.order_by)) q = q.order(input.order_by, { ascending: !input.descending, nullsFirst: false });
    const limit = Math.max(1, Math.min(200, Number(input.limit) || 50));
    const { data, error, count } = await q.limit(limit);
    if (error) throw new Error(error.message);
    return { total_matching: count, returned: data?.length || 0, rows: data };
  }
  if (name === 'ssa_balances') {
    // Same rule as src/core/timesheets.js balances(): opening + change since, change = (deleted ? 0 : hours) - opening_hours.
    const rows = await sql`
      select c.name, c.archived, c.hours_purchased::float purchased,
             round((c.opening_used + coalesce(d.change, 0))::numeric, 2)::float used,
             round((c.opening_remaining + (c.hours_purchased - c.opening_purchased) - coalesce(d.change, 0))::numeric, 2)::float remaining
        from public.ssa_clients c
        left join (select client_id, sum((case when deleted_at is null then hours else 0 end) - coalesce(opening_hours, 0)) change
                     from public.timesheet_entries group by client_id) d on d.client_id = c.id
       order by remaining`;
    return rows;
  }
  if (name === 'timesheet_hours') {
    const day = /^\d{4}-\d{2}-\d{2}$/;
    if (!day.test(input.from) || !day.test(input.to)) throw new Error('Dates must be YYYY-MM-DD');
    const like = `%${String(input.client || '')}%`;
    const entries = await sql`
      select e.entry_date::text date, c.name client, e.engineer, e.hours::float hours, coalesce(nullif(e.work_type, ''), 'No work type') work_type,
             coalesce(nullif(e.work_description, ''), e.title) description
        from public.timesheet_entries e join public.ssa_clients c on c.id = e.client_id
       where e.deleted_at is null and e.entry_date between ${input.from}::date and ${input.to}::date
         and lower(e.engineer) <> 'system' and c.name ilike ${like}
       order by e.entry_date, c.name`;
    const sum = (key: string) => {
      const m: Record<string, number> = {};
      for (const e of entries as any[]) m[e[key]] = Math.round(((m[e[key]] || 0) + e.hours) * 100) / 100;
      return Object.entries(m).sort((a, b) => b[1] - a[1]).map(([k, h]) => ({ [key]: k, hours: h }));
    };
    return {
      total_hours: Math.round(entries.reduce((t: number, e: any) => t + e.hours, 0) * 100) / 100,
      by_client: sum('client'), by_engineer: sum('engineer'), by_work_type: sum('work_type'),
      entries: entries.length <= 60 ? entries : `${entries.length} entries (too many to list; ask about one client or a shorter period)`
    };
  }
  if (name === 'xero_sales') {
    const day = /^\d{4}-\d{2}-\d{2}$/;
    if (!day.test(input.from) || !day.test(input.to)) throw new Error('Dates must be YYYY-MM-DD');
    const rows = await sql`
      select contact_name, status, invoice_number, invoice_date::text, sub_total::float net, repeating_invoice_id <> '' repeating
        from public.xero_invoices
       where invoice_date between ${input.from}::date and ${input.to}::date and status in ('AUTHORISED', 'PAID', 'DRAFT')
       order by invoice_date`;
    const keep = (r: any) => input.include_commission || !/voip\s*unlimited/i.test(r.contact_name);
    const real = rows.filter((r: any) => r.status !== 'DRAFT' && keep(r));
    const per: Record<string, { net: number; recurring: number; invoices: number }> = {};
    for (const r of real) {
      const p = per[r.contact_name] ||= { net: 0, recurring: 0, invoices: 0 };
      p.net = Math.round((p.net + r.net) * 100) / 100; p.invoices++;
      if (r.repeating) p.recurring = Math.round((p.recurring + r.net) * 100) / 100;
    }
    return {
      total_net: Math.round(real.reduce((t: number, r: any) => t + r.net, 0) * 100) / 100,
      per_contact: Object.entries(per).sort((a, b) => b[1].net - a[1].net).map(([contact, v]) => ({ contact, ...v })),
      drafts_not_counted: rows.filter((r: any) => r.status === 'DRAFT' && keep(r)).map((r: any) => ({ contact: r.contact_name, number: r.invoice_number, date: r.invoice_date, net: r.net }))
    };
  }
  throw new Error(`Unknown tool ${name}`);
}

Deno.serve(async req => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  const started = Date.now();
  try {
    const email = await staffEmail(req);
    if (!email) return json({ error: 'Only Gecko staff can use Ask Gecko HQ' }, 403);
    if (!Deno.env.get('ANTHROPIC_API_KEY')) return json({ error: 'Ask Gecko HQ isn’t switched on yet: ANTHROPIC_API_KEY is not set in Supabase › Edge Functions › Secrets.' }, 503);

    const body = await req.json().catch(() => ({}));
    const question = String(body.question || '').trim().slice(0, 1000);
    if (!question) return json({ error: 'Type a question first.' }, 400);
    const [{ n }] = await sql`select count(*)::int n from public.ask_log where created_at > now() - interval '1 day'`;
    if (n >= DAILY_LIMIT) return json({ error: `That’s ${DAILY_LIMIT} questions in the last 24 hours, the daily limit. Try again later.` }, 429);

    // Earlier turns of this conversation (text only, last 6), then today's date and the question.
    const history: Anthropic.MessageParam[] = (Array.isArray(body.history) ? body.history : []).slice(-6)
      .filter((m: any) => (m.role === 'user' || m.role === 'assistant') && typeof m.content === 'string' && m.content.trim())
      .map((m: any) => ({ role: m.role, content: String(m.content).slice(0, 4000) }));
    if (history.length && history[0].role !== 'user') history.shift();
    const today = new Date().toLocaleDateString('en-GB', { timeZone: 'Europe/London', weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
    const iso = new Date().toLocaleDateString('en-CA', { timeZone: 'Europe/London' });
    const messages: Anthropic.MessageParam[] = [...history, { role: 'user', content: `(Today is ${today}, ${iso}. Asked by ${email}.)\n\n${question}` }];

    const apikey = req.headers.get('apikey') || PUBLISHABLE_KEY;
    const ctx: Ctx = { db: createClient(Deno.env.get('SUPABASE_URL')!, apikey, { global: { headers: { Authorization: req.headers.get('authorization')! } }, auth: { persistSession: false } }) };
    const client = new Anthropic();
    const system = SYSTEM(await describeTables());

    let answer = '', rounds = 0, toolCalls = 0, inTok = 0, outTok = 0, refused = false;
    while (rounds++ < MAX_ROUNDS) {
      const res: any = await (client.beta.messages.create as any)({
        model: MODEL,
        max_tokens: 16000,
        betas: ['server-side-fallback-2026-07-01'],
        fallbacks: 'default',
        output_config: { effort: 'medium' },
        cache_control: { type: 'ephemeral' },
        system,
        tools,
        messages
      });
      inTok += (res.usage?.input_tokens || 0) + (res.usage?.cache_read_input_tokens || 0) + (res.usage?.cache_creation_input_tokens || 0);
      outTok += res.usage?.output_tokens || 0;
      if (res.stop_reason === 'refusal') { refused = true; answer = 'Sorry, I can’t answer that one.'; break; }
      messages.push({ role: 'assistant', content: res.content });
      if (res.stop_reason === 'pause_turn') continue;
      const uses = res.content.filter((b: any) => b.type === 'tool_use');
      if (!uses.length) {
        answer = res.content.filter((b: any) => b.type === 'text').map((b: any) => b.text).join('\n').trim();
        if (res.stop_reason === 'max_tokens') answer += '\n\n(The answer was cut short.)';
        break;
      }
      const results: Anthropic.ToolResultBlockParam[] = [];
      for (const u of uses) {
        toolCalls++;
        try {
          results.push({ type: 'tool_result', tool_use_id: u.id, content: JSON.stringify(await runTool(u.name, u.input, ctx)).slice(0, 60000) });
        } catch (err) {
          results.push({ type: 'tool_result', tool_use_id: u.id, content: String((err as Error).message || err), is_error: true });
        }
      }
      messages.push({ role: 'user', content: results });
    }
    if (!answer) answer = 'I couldn’t finish looking that up. Try a narrower question.';

    await sql`insert into public.ask_log (asked_by, question, answer, tool_calls, input_tokens, output_tokens, refused, ms)
              values (${email}, ${question}, ${answer}, ${toolCalls}, ${inTok}, ${outTok}, ${refused}, ${Date.now() - started})`;
    return json({ answer });
  } catch (err) {
    console.error('ask:', err);
    const e = err as any;
    const msg = e?.status === 401 ? 'The Anthropic API key was refused. Check ANTHROPIC_API_KEY in Supabase › Edge Functions › Secrets.'
      : e?.status === 429 ? 'Claude is busy (rate limited). Try again in a minute.'
      : e?.status >= 500 ? 'Claude didn’t answer (a temporary problem). Try again.'
      : String(e?.message || e);
    return json({ error: msg }, 500);
  }
});
