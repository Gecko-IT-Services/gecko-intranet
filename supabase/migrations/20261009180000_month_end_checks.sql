-- Month-end close (Philip, 9 Oct 2026: done in the last working days of the month). Most checks tick
-- themselves from the data (Overview › Month-end, src/core/review.js); the supplier checks Gecko does
-- by hand (TD SYNNEX licences, Atera costs) are ticked by a person and kept here, one row per month
-- and check. Unticking deletes the row.
-- Design: docs/superpowers/specs/2026-10-09-gecko-hq-structure-design.md (stage 5)

create table public.month_end_checks (
  id         bigint generated always as identity primary key,
  month      text not null check (month ~ '^\d{4}-\d{2}$'),
  item       text not null check (item <> ''),
  done_by    text not null default '',
  done_at    timestamptz not null default now(),
  unique (month, item)
);
alter table public.month_end_checks enable row level security;
create policy month_end_checks_staff_all on public.month_end_checks
  for all to authenticated using (public.is_gecko_staff()) with check (public.is_gecko_staff());
