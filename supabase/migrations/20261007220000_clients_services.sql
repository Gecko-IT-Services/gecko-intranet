-- GeckoClients and GeckoServices, column for column. Services link to clients
-- by name (client_name = gecko_clients.title), exactly as in SharePoint;
-- renames cascade in the page (cliCascadeServiceRename). No foreign key, so
-- the copy reproduces SharePoint as it is, orphans included.

create table public.gecko_clients (
  id             bigint generated always as identity primary key,
  title          text not null default '',      -- client name
  status         text not null default 'Active',
  contract_start date,
  notes          text not null default '',
  -- Xero totals per month: the same JSON text SharePoint held, keyed
  -- by YYYY-MM and written by Profitability from the feed.
  xero_history   text not null default '',
  sharepoint_id  text unique,
  created_at     timestamptz not null default now(),
  modified_at    timestamptz not null default now()
);

create trigger gecko_clients_touch before update on public.gecko_clients
  for each row execute function public.touch_modified_at();

alter table public.gecko_clients enable row level security;

create policy gecko_clients_staff_all on public.gecko_clients
  for all to authenticated
  using (public.is_gecko_staff())
  with check (public.is_gecko_staff());

create table public.gecko_services (
  id             bigint generated always as identity primary key,
  title          text not null default '',      -- service line name
  client_name    text not null default '',
  category       text not null default '',
  cost_per_month numeric not null default 0,
  sell_per_month numeric not null default 0,
  notes          text not null default '',
  sharepoint_id  text unique,
  created_at     timestamptz not null default now(),
  modified_at    timestamptz not null default now()
);

create trigger gecko_services_touch before update on public.gecko_services
  for each row execute function public.touch_modified_at();

alter table public.gecko_services enable row level security;

create policy gecko_services_staff_all on public.gecko_services
  for all to authenticated
  using (public.is_gecko_staff())
  with check (public.is_gecko_staff());
