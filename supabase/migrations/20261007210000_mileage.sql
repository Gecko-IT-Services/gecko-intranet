-- MileageJourneys and MileageClients, column for column. HMRC mileage records:
-- keep 6 years after the tax year ends; nothing here deletes on a schedule.

create table public.mileage_journeys (
  id            bigint generated always as identity primary key,
  title         text not null default '',      -- destination
  driver        text not null default '',
  journey_date  date,
  miles         numeric not null default 0,
  purpose       text not null default '',
  amount        numeric not null default 0,    -- £, recomputed by the page (HMRC rates)
  rate_type     text not null default '',
  claimed_date  date,                          -- null = unclaimed
  sharepoint_id text unique,
  created_at    timestamptz not null default now(),
  modified_at   timestamptz not null default now()
);

create trigger mileage_journeys_touch before update on public.mileage_journeys
  for each row execute function public.touch_modified_at();

alter table public.mileage_journeys enable row level security;

create policy mileage_journeys_staff_all on public.mileage_journeys
  for all to authenticated
  using (public.is_gecko_staff())
  with check (public.is_gecko_staff());

create table public.mileage_clients (
  id            bigint generated always as identity primary key,
  title         text not null default '',      -- destination name
  typical_miles numeric not null default 0,
  sharepoint_id text unique,
  created_at    timestamptz not null default now(),
  modified_at   timestamptz not null default now()
);

create trigger mileage_clients_touch before update on public.mileage_clients
  for each row execute function public.touch_modified_at();

alter table public.mileage_clients enable row level security;

create policy mileage_clients_staff_all on public.mileage_clients
  for all to authenticated
  using (public.is_gecko_staff())
  with check (public.is_gecko_staff());
