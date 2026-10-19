-- AI-written client emails (Philip, 19 Oct 2026: "a free note section … to give emails such as this context"; chose the AI option,
-- reversing the 11 Oct "no paid AI" decision for this one use). Design: docs/superpowers/specs/2026-10-19-ai-client-emails-design.md

-- How a client is set up, in Gecko's own words (Philip, 19 Oct: "explain in our own words each client and how they are setup so that
-- when emails … get composed you have proper context"): their people, sites, systems, what's agreed, what to avoid. Internal: never
-- shown to the client as written; the email writer reads it as background for every email to that client.
create table public.client_notes (
  client_name   text primary key,
  setup         text not null default '' check (length(setup) <= 8000),
  updated_by    text not null default '',
  modified_at   timestamptz not null default now()
);
create trigger client_notes_touch before update on public.client_notes
  for each row execute function public.touch_modified_at();
alter table public.client_notes enable row level security;
create policy client_notes_staff_all on public.client_notes
  for all to authenticated using (public.is_gecko_staff()) with check (public.is_gecko_staff());

-- Every email the writer produces: who, which client, and what it cost (tokens), so the running cost is visible. Written by the
-- Edge Function only.
create table public.ai_email_log (
  id            bigint generated always as identity primary key,
  client_name   text not null,
  kind          text not null,
  created_by    text not null,
  model         text not null default '',
  input_tokens  int not null default 0,
  output_tokens int not null default 0,
  cost_usd      numeric not null default 0,
  ok            boolean not null default true,
  error         text not null default '',
  created_at    timestamptz not null default now()
);
create index ai_email_log_day on public.ai_email_log (created_at);
alter table public.ai_email_log enable row level security;
create policy ai_email_log_staff_read on public.ai_email_log for select to authenticated using (public.is_gecko_staff());
