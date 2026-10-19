-- Dates that come round (Philip, 19 Oct 2026: "yes build the dates next"): when each client domain expires, so a renewal is never missed
-- and a domain Gecko doesn't look after can be offered before it lapses (a lapsed domain stops email and the website). Filled by the
-- domain-check Edge Function from public registry data (RDAP, no key), weekly and on demand. Staff read only.
-- Design: docs/superpowers/specs/2026-10-19-dates-come-round-design.md
create table public.domain_dates (
  domain        text primary key,
  client_name   text not null default '',
  sources       text[] not null default '{}',   -- where the domain was found: xero (a hosting/domain line), email (a contact), website
  billed        boolean not null default false, -- on a Xero repeating invoice: Gecko renews it
  expires_on    date,
  registrar     text not null default '',
  error         text not null default '',
  checked_at    timestamptz not null default now()
);
alter table public.domain_dates enable row level security;
create policy domain_dates_staff_read on public.domain_dates for select to authenticated using (public.is_gecko_staff());

create table public.domain_status (
  id            int primary key default 1 check (id = 1),
  last_sync_at  timestamptz,
  last_sync_ok  boolean,
  last_error    text not null default '',
  domains       int not null default 0
);
insert into public.domain_status (id) values (1);
alter table public.domain_status enable row level security;
create policy domain_status_staff_read on public.domain_status for select to authenticated using (public.is_gecko_staff());

-- Mondays 05:23 UTC (before the Monday brief), same scheduler and secret as the other syncs.
do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') and exists (select 1 from pg_extension where extname = 'pg_net') then
    perform cron.schedule('domain-check', '23 5 * * 1', $job$
      select net.http_post(
        url := 'https://nkobrqzsogtyxriqqwnq.supabase.co/functions/v1/domain-check',
        headers := jsonb_build_object('content-type', 'application/json',
                                      'x-cron-secret', (select secret from private.cron_secret where id = 1)),
        body := '{}'::jsonb,
        timeout_milliseconds := 120000)
    $job$);
  end if;
end $$;
