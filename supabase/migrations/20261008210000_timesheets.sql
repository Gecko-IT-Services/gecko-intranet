-- Timesheets and SSA balances move to the database (Philip, 8 Oct 2026: "Supabase master +
-- SharePoint backup"). The dashboard writes here first, then copies every change to the
-- SharePoint Timesheets / Clients lists exactly as it does today, so Microsoft Lists stays a
-- complete backup and the Power Automate flows keep working on it.
-- Design: docs/superpowers/specs/2026-10-08-timesheets-on-supabase-design.md
--
-- Balances are never recalculated from history (Philip's rule, 7 Oct). The copy takes each
-- client's Hours Used / Remaining as they stand (opening_*), and each copied entry's hours
-- (opening_hours). From then on a client's balance moves only by what changes:
--   change of an entry = (hours if not deleted, else 0) - coalesce(opening_hours, 0)
--   used      = opening_used + sum(change)
--   remaining = opening_remaining + (hours_purchased - opening_purchased) - sum(change)
-- Untouched copied entries change nothing; new entries add their hours; an edit moves the
-- balance by the difference; a delete takes the entry's hours off (or a credit's back on).

create table public.ssa_clients (
  id                 bigint generated always as identity primary key,
  sharepoint_id      text not null unique,          -- the Clients list item (Timesheets' lookup target)
  name               text not null default '',
  hours_purchased    numeric not null default 0,
  opening_purchased  numeric not null default 0,
  opening_used       numeric not null default 0,
  opening_remaining  numeric not null default 0,
  primary_contact    text not null default '',
  email              text not null default '',
  client_folder      text not null default '',
  archived           boolean not null default false,
  opened_at          timestamptz not null default now(),  -- when the opening balance was taken
  created_at         timestamptz not null default now(),
  modified_at        timestamptz not null default now()
);

create table public.timesheet_entries (
  id               bigint generated always as identity primary key,
  sharepoint_id    text unique,                     -- null until copied to SharePoint
  client_id        bigint not null references public.ssa_clients(id),
  engineer         text not null default '',
  entry_date       date,
  hours            numeric not null default 0,
  title            text not null default '',
  work_type        text not null default '',
  work_description text not null default '',
  internal_notes   text not null default '',
  atera_id         bigint,
  archived         boolean not null default false,  -- SharePoint's Archived (set by the archive flow)
  opening_hours    numeric,                          -- hours when copied; null for entries made since
  deleted_at       timestamptz,                      -- kept, so the balance and the audit trail add up
  sp_state         text not null default 'pending' check (sp_state in ('synced','pending','failed')),
  sp_error         text not null default '',
  sp_delta         numeric not null default 0,      -- Hours Used change still to make on SharePoint
  sp_modified      timestamptz,                      -- SharePoint's Modified when last read or written
  created_by       text not null default '',
  created_at       timestamptz not null default now(),
  modified_at      timestamptz not null default now(),
  -- Work is logged in quarter hours. Copied history is kept exactly as it was.
  constraint timesheet_entries_quarter_hours check (opening_hours is not null or hours * 4 = round(hours * 4))
);

create index timesheet_entries_client on public.timesheet_entries (client_id);

create trigger ssa_clients_touch before update on public.ssa_clients
  for each row execute function public.touch_modified_at();
create trigger timesheet_entries_touch before update on public.timesheet_entries
  for each row execute function public.touch_modified_at();

alter table public.ssa_clients enable row level security;
create policy ssa_clients_staff_all on public.ssa_clients
  for all to authenticated using (public.is_gecko_staff()) with check (public.is_gecko_staff());
alter table public.timesheet_entries enable row level security;
create policy timesheet_entries_staff_all on public.timesheet_entries
  for all to authenticated using (public.is_gecko_staff()) with check (public.is_gecko_staff());

-- Atera alert resolutions (was the GeckoAlertResolutions SharePoint list).
create table public.alert_resolutions (
  id            bigint generated always as identity primary key,
  issue_key     text not null check (issue_key <> ''),
  resolved_by   text not null default '',
  note          text not null default '',
  sharepoint_id text unique,
  created_at    timestamptz not null default now(),
  modified_at   timestamptz not null default now()
);
create index alert_resolutions_key on public.alert_resolutions (issue_key);
create trigger alert_resolutions_touch before update on public.alert_resolutions
  for each row execute function public.touch_modified_at();
alter table public.alert_resolutions enable row level security;
create policy alert_resolutions_staff_all on public.alert_resolutions
  for all to authenticated using (public.is_gecko_staff()) with check (public.is_gecko_staff());
