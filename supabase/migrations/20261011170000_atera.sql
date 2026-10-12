-- Atera devices per client (Philip, 10–11 Oct 2026). Filled by the `atera-sync` Edge Function (API key in Supabase ›
-- Edge Functions › Secrets: ATERA_API_KEY) four times a day and on demand; staff read only, nothing writes from the site.
-- Each row keeps Atera's full record in `raw` (Atera doesn't publish a fixed schema we can rely on); the columns are
-- what the function picked out of it. Design: docs/superpowers/specs/2026-10-11-atera-devices-design.md

create table public.atera_customers (
  customer_id   bigint primary key,
  name          text not null default '',
  raw           jsonb not null default '{}',
  synced_at     timestamptz not null default now()
);

create table public.atera_agents (
  agent_id      bigint primary key,
  customer_id   bigint,
  customer_name text not null default '',
  machine_name  text not null default '',
  device_type   text not null default '',   -- Atera's OSType: Work Station, Server, Domain Controller…
  os            text not null default '',   -- e.g. "Microsoft Windows 10 Pro"
  os_version    text not null default '',
  online        boolean,
  last_seen     timestamptz,                -- best "last heard from" date Atera gives (see last_seen_field)
  last_seen_field text not null default '', -- which Atera field that came from
  last_user     text not null default '',
  vendor        text not null default '',
  model         text not null default '',
  serial        text not null default '',
  raw           jsonb not null default '{}',
  synced_at     timestamptz not null default now()
);
create index atera_agents_customer on public.atera_agents (customer_id);

create table public.atera_status (
  id            int primary key default 1 check (id = 1),
  last_sync_at  timestamptz,
  last_sync_ok  boolean,
  last_error    text not null default '',
  customers     int not null default 0,
  agents        int not null default 0
);
insert into public.atera_status (id) values (1);

alter table public.atera_customers enable row level security;
alter table public.atera_agents enable row level security;
alter table public.atera_status enable row level security;
create policy atera_customers_staff_read on public.atera_customers for select to authenticated using (public.is_gecko_staff());
create policy atera_agents_staff_read on public.atera_agents for select to authenticated using (public.is_gecko_staff());
create policy atera_status_staff_read on public.atera_status for select to authenticated using (public.is_gecko_staff());

-- Four times a day (devices don't change by the minute), same scheduler and secret as the Xero sync.
do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') and exists (select 1 from pg_extension where extname = 'pg_net') then
    perform cron.schedule('atera-sync', '43 5,11,15,19 * * *', $job$
      select net.http_post(
        url := 'https://nkobrqzsogtyxriqqwnq.supabase.co/functions/v1/atera-sync',
        headers := jsonb_build_object('content-type', 'application/json',
                                      'x-cron-secret', (select secret from private.cron_secret where id = 1)),
        body := '{}'::jsonb)
    $job$);
  end if;
end $$;
