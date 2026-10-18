-- Webroot (OpenText) sites and endpoints per client (Philip, 18 Oct 2026). Filled by the `webroot-sync` Edge Function
-- (secrets in Supabase › Edge Functions › Secrets: WEBROOT_CLIENT_ID, WEBROOT_CLIENT_SECRET, WEBROOT_USERNAME,
-- WEBROOT_PASSWORD, WEBROOT_GSM_KEY) four times a day and on demand; staff read only. Rows keep Webroot's full record in `raw`.
-- Part of the Atera reconcile: what Atera bills Gecko ↔ what clients use ↔ what Xero bills them.
-- Design: docs/superpowers/specs/2026-10-18-atera-reconcile-design.md

create table public.webroot_sites (
  site_id       text primary key,
  name          text not null default '',
  raw           jsonb not null default '{}',
  synced_at     timestamptz not null default now()
);

create table public.webroot_endpoints (
  endpoint_id   text primary key,
  site_id       text not null,
  hostname      text not null default '',
  raw           jsonb not null default '{}',
  synced_at     timestamptz not null default now()
);
create index webroot_endpoints_site on public.webroot_endpoints (site_id);

create table public.webroot_status (
  id            int primary key default 1 check (id = 1),
  last_sync_at  timestamptz,
  last_sync_ok  boolean,
  last_error    text not null default '',
  sites         int not null default 0,
  endpoints     int not null default 0,
  problems      jsonb not null default '[]'
);
insert into public.webroot_status (id) values (1);

alter table public.webroot_sites enable row level security;
alter table public.webroot_endpoints enable row level security;
alter table public.webroot_status enable row level security;
create policy webroot_sites_staff_read on public.webroot_sites for select to authenticated using (public.is_gecko_staff());
create policy webroot_endpoints_staff_read on public.webroot_endpoints for select to authenticated using (public.is_gecko_staff());
create policy webroot_status_staff_read on public.webroot_status for select to authenticated using (public.is_gecko_staff());

do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') and exists (select 1 from pg_extension where extname = 'pg_net') then
    perform cron.schedule('webroot-sync', '23 6,11,15,19 * * *', $job$
      select net.http_post(
        url := 'https://nkobrqzsogtyxriqqwnq.supabase.co/functions/v1/webroot-sync',
        headers := jsonb_build_object('content-type', 'application/json',
                                      'x-cron-secret', (select secret from private.cron_secret where id = 1)),
        body := '{}'::jsonb)
    $job$);
  end if;
end $$;
