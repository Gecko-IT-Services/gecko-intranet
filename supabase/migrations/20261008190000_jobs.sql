-- Jobs: one-off work for clients (MSA Safety, Onsite Commercial Services, Clarke Lane
-- Engineering…), with a value, from quote to invoice (Philip, 8 Oct 2026). Replaces the
-- old Projects board, which was taken off the menu on 6 Oct; its open projects can be
-- brought across once from the Jobs page (source_ref keeps that idempotent).
-- Design: docs/superpowers/specs/2026-10-08-jobs-design.md

create table public.jobs (
  id           bigint generated always as identity primary key,
  client_name  text not null check (client_name <> ''),
  title        text not null check (title <> ''),
  status       text not null default 'quoted'
                 check (status in ('quoted','agreed','in_progress','to_invoice','invoiced','lost')),
  value        numeric check (value is null or value >= 0),  -- £ net to invoice; null = not priced yet
  target_date  date,                                        -- when we expect to finish / invoice
  invoice_ref  text not null default '',                    -- Xero invoice number once raised
  invoiced_at  date,
  owner        text not null default '',
  next_step    text not null default '',
  notes        text not null default '',
  source_ref   text unique,                                 -- e.g. 'projects:12' when brought across
  created_at   timestamptz not null default now(),
  modified_at  timestamptz not null default now()
);

create trigger jobs_touch before update on public.jobs
  for each row execute function public.touch_modified_at();
alter table public.jobs enable row level security;
create policy jobs_staff_all on public.jobs
  for all to authenticated using (public.is_gecko_staff()) with check (public.is_gecko_staff());
