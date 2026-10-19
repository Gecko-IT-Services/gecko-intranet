-- The Monday brief (Philip, 19 Oct 2026; chose "From Gecko HQ"): made in the reader's Outlook Drafts the first time Overview opens on
-- a Monday. One row per person per week, so it's made once even across devices. Design: docs/superpowers/specs/2026-10-19-monday-brief-design.md
create table public.weekly_briefs (
  week_start    date not null,
  made_by       text not null,
  made_at       timestamptz not null default now(),
  primary key (week_start, made_by)
);
alter table public.weekly_briefs enable row level security;
create policy weekly_briefs_staff_all on public.weekly_briefs
  for all to authenticated using (public.is_gecko_staff()) with check (public.is_gecko_staff());
