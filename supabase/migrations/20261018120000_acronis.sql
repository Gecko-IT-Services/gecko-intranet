-- Acronis Cyber Protect Cloud per client (Philip, 18 Oct 2026). Filled by the `acronis-sync` Edge Function (secrets in
-- Supabase › Edge Functions › Secrets: ACRONIS_CLIENT_ID, ACRONIS_CLIENT_SECRET, ACRONIS_BASE_URL) four times a day and on
-- demand; staff read only, nothing writes from the site. Rows keep Acronis's full record in `raw`.
-- Design: docs/superpowers/specs/2026-10-18-acronis-sync-design.md

create table public.acronis_tenants (
  tenant_id     text primary key,
  name          text not null default '',
  kind          text not null default '',   -- customer, folder, partner…
  parent_id     text not null default '',
  raw           jsonb not null default '{}',
  synced_at     timestamptz not null default now()
);

-- One row per thing Acronis told us about: kind = usage, resource, resource_status, agent, policy, alert.
create table public.acronis_items (
  kind          text not null,
  item_id       text not null,
  tenant_id     text not null,
  raw           jsonb not null default '{}',
  synced_at     timestamptz not null default now(),
  primary key (kind, item_id)
);
create index acronis_items_tenant on public.acronis_items (tenant_id, kind);

create table public.acronis_status (
  id            int primary key default 1 check (id = 1),
  last_sync_at  timestamptz,
  last_sync_ok  boolean,
  last_error    text not null default '',
  tenants       int not null default 0,
  counts        jsonb not null default '{}',  -- rows per kind from the last run
  problems      jsonb not null default '[]'   -- endpoints that failed for a customer: [{tenant, kind, error}]
);
insert into public.acronis_status (id) values (1);

alter table public.acronis_tenants enable row level security;
alter table public.acronis_items enable row level security;
alter table public.acronis_status enable row level security;
create policy acronis_tenants_staff_read on public.acronis_tenants for select to authenticated using (public.is_gecko_staff());
create policy acronis_items_staff_read on public.acronis_items for select to authenticated using (public.is_gecko_staff());
create policy acronis_status_staff_read on public.acronis_status for select to authenticated using (public.is_gecko_staff());

-- Four times a day, after the morning backups have reported, same scheduler and secret as the Atera and Xero syncs.
do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') and exists (select 1 from pg_extension where extname = 'pg_net') then
    perform cron.schedule('acronis-sync', '13 6,11,15,19 * * *', $job$
      select net.http_post(
        url := 'https://nkobrqzsogtyxriqqwnq.supabase.co/functions/v1/acronis-sync',
        headers := jsonb_build_object('content-type', 'application/json',
                                      'x-cron-secret', (select secret from private.cron_secret where id = 1)),
        body := '{}'::jsonb)
    $job$);
  end if;
end $$;
