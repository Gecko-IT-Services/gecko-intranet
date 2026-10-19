-- AI read-outs kept per client (Philip, 19 Oct 2026: "1-3 i like very much"). First: "What we keep fixing", the patterns in six months
-- of a client's timesheet notes, each with the product that would stop it, as sales evidence. The AI only groups entries; the counts
-- and hours are Gecko HQ's own sums of those entries, so every figure can be checked against the timesheets.
-- Written by the client-ai Edge Function only; staff read. Design: docs/superpowers/specs/2026-10-19-what-we-keep-fixing-design.md
create table public.client_insights (
  id            bigint generated always as identity primary key,
  client_name   text not null,
  kind          text not null check (kind in ('evidence', 'review')),
  data          jsonb not null default '{}',
  period_from   date,
  period_to     date,
  model         text not null default '',
  created_by    text not null default '',
  created_at    timestamptz not null default now()
);
create index client_insights_latest on public.client_insights (client_name, kind, created_at desc);
alter table public.client_insights enable row level security;
create policy client_insights_staff_read on public.client_insights for select to authenticated using (public.is_gecko_staff());
