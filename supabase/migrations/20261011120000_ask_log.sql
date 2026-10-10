-- Ask Gecko HQ (11 Oct 2026): one row per question, written by the `ask` Edge Function (service connection).
-- Staff can read it (who asked what, the answer, and the tokens it used); nobody writes it from the site.
-- Design: docs/superpowers/specs/2026-10-11-ask-gecko-hq-design.md
create table public.ask_log (
  id            bigint generated always as identity primary key,
  asked_by      text not null default '',
  question      text not null default '',
  answer        text not null default '',
  tool_calls    int not null default 0,
  input_tokens  int not null default 0,
  output_tokens int not null default 0,
  refused       boolean not null default false,
  ms            int not null default 0,
  created_at    timestamptz not null default now()
);
create index ask_log_created on public.ask_log (created_at);
alter table public.ask_log enable row level security;
create policy ask_log_staff_read on public.ask_log
  for select to authenticated using (public.is_gecko_staff());
