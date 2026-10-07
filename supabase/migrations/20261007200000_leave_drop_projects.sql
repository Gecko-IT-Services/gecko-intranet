-- Projects is off the menu (Philip, 6 Oct) and is not moving; its table was
-- created empty by the previous migration and nothing reads it.
drop table public.projects;

-- GeckoLeaveRequests and GeckoLeaveEntitlements, column for column.
-- No check constraints on Person/Status/LeaveType: the import copies whatever
-- SharePoint holds, exactly, and the page already normalises what it reads.

create table public.leave_requests (
  id                 bigint generated always as identity primary key,
  title              text not null default '',
  person             text not null default '',
  start_date         date,
  end_date           date,
  hours              numeric not null default 0,
  status             text not null default 'Pending',
  leave_type         text not null default 'Annual Leave',
  notes              text not null default '',
  requested_by       text not null default '',
  requested_by_email text not null default '',
  approved_by        text not null default '',
  approved_at        timestamptz,
  tax_year           text not null default '',
  created_by_portal  boolean not null default false,
  -- SharePoint item id, set only by the copy (traceability, and the check).
  sharepoint_id      text unique,
  created_at         timestamptz not null default now(),
  modified_at        timestamptz not null default now()
);

create trigger leave_requests_touch before update on public.leave_requests
  for each row execute function public.touch_modified_at();

alter table public.leave_requests enable row level security;

create policy leave_requests_staff_all on public.leave_requests
  for all to authenticated
  using (public.is_gecko_staff())
  with check (public.is_gecko_staff());

-- Edited by hand (Table Editor), read by the page. Hours, like the list.
create table public.leave_entitlements (
  id                bigint generated always as identity primary key,
  person            text not null default '',
  tax_year          text not null default '',
  entitlement_hours numeric not null default 0,
  carry_over_hours  numeric not null default 0,
  adjustment_hours  numeric not null default 0,
  notes             text not null default '',
  sharepoint_id     text unique,
  created_at        timestamptz not null default now(),
  modified_at       timestamptz not null default now()
);

create trigger leave_entitlements_touch before update on public.leave_entitlements
  for each row execute function public.touch_modified_at();

alter table public.leave_entitlements enable row level security;

create policy leave_entitlements_staff_all on public.leave_entitlements
  for all to authenticated
  using (public.is_gecko_staff())
  with check (public.is_gecko_staff());
