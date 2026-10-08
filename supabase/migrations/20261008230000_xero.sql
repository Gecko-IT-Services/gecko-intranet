-- Xero connected directly (Philip, 8 Oct 2026: "establish a proper Xero integration").
-- Edge Functions in supabase/functions/xero-* talk to Xero; the site only ever reads the
-- tables below. Design: docs/superpowers/specs/2026-10-08-xero-integration-design.md
--
-- Secrets never reach the browser: the Xero client id/secret are Edge Function secrets, and
-- the OAuth tokens live in the `private` schema, which the API does not expose and no
-- browser role can read. The public tables are read-only for staff; only the functions
-- (database owner) write them.

create schema if not exists private;
revoke all on schema private from public;
do $$ begin
  if exists (select 1 from pg_roles where rolname = 'anon') then execute 'revoke all on schema private from anon'; end if;
  if exists (select 1 from pg_roles where rolname = 'authenticated') then execute 'revoke all on schema private from authenticated'; end if;
end $$;

create table private.xero_tokens (
  id               int primary key default 1 check (id = 1),
  tenant_id        text not null,
  tenant_name      text not null default '',
  refresh_token    text not null,
  access_token     text not null default '',
  access_expires   timestamptz,
  scopes           text not null default '',
  connected_by     text not null default '',
  connected_at     timestamptz not null default now()
);

create table private.xero_oauth_states (
  state       text primary key,
  email       text not null,
  created_at  timestamptz not null default now()
);

-- The hourly sync proves it's the scheduler with this, not a key in the site.
create table private.cron_secret (
  id     int primary key default 1 check (id = 1),
  secret text not null default replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', '')
);
insert into private.cron_secret default values;

-- What the site shows about the connection (no tokens).
create table public.xero_status (
  id            int primary key default 1 check (id = 1),
  connected     boolean not null default false,
  tenant_name   text not null default '',
  connected_by  text not null default '',
  connected_at  timestamptz,
  last_sync_at  timestamptz,
  last_sync_ok  boolean,
  last_error    text not null default '',
  invoices      int not null default 0,
  repeating     int not null default 0,
  modified_at   timestamptz not null default now()
);
insert into public.xero_status default values;
alter table public.xero_status enable row level security;
create policy xero_status_staff_read on public.xero_status
  for select to authenticated using (public.is_gecko_staff());

-- Sales invoices (ACCREC), every status, as Xero has them.
create table public.xero_invoices (
  invoice_id      text primary key,
  invoice_number  text not null default '',
  contact_id      text not null default '',
  contact_name    text not null default '',
  invoice_date    date,
  due_date        date,
  status          text not null default '',            -- DRAFT, SUBMITTED, AUTHORISED, PAID, VOIDED, DELETED
  reference       text not null default '',
  sub_total       numeric not null default 0,           -- net of VAT
  total_tax       numeric not null default 0,
  total           numeric not null default 0,
  amount_due      numeric not null default 0,
  amount_paid     numeric not null default 0,
  currency        text not null default 'GBP',
  repeating_invoice_id text not null default '',        -- set when raised from a repeating invoice
  line_items      jsonb not null default '[]',
  updated_utc     timestamptz,
  synced_at       timestamptz not null default now()
);
create index xero_invoices_date on public.xero_invoices (invoice_date);
create index xero_invoices_number on public.xero_invoices (invoice_number);
alter table public.xero_invoices enable row level security;
create policy xero_invoices_staff_read on public.xero_invoices
  for select to authenticated using (public.is_gecko_staff());

-- Repeating invoice templates: what is due to be raised, and when.
create table public.xero_repeating_invoices (
  repeating_invoice_id text primary key,
  contact_id      text not null default '',
  contact_name    text not null default '',
  status          text not null default '',             -- DRAFT, AUTHORISED
  reference       text not null default '',
  period          int,
  unit            text not null default '',             -- WEEKLY, MONTHLY
  start_date      date,
  next_date       date,
  end_date        date,
  sub_total       numeric not null default 0,
  total           numeric not null default 0,
  line_items      jsonb not null default '[]',
  synced_at       timestamptz not null default now()
);
alter table public.xero_repeating_invoices enable row level security;
create policy xero_repeating_invoices_staff_read on public.xero_repeating_invoices
  for select to authenticated using (public.is_gecko_staff());

-- Hourly sync, where the scheduler extensions are available (they are on Supabase).
do $$
begin
  if exists (select 1 from pg_available_extensions where name = 'pg_cron')
     and exists (select 1 from pg_available_extensions where name = 'pg_net') then
    create extension if not exists pg_cron;
    create extension if not exists pg_net;
    perform cron.schedule('xero-sync-hourly', '17 * * * *', $job$
      select net.http_post(
        url := 'https://nkobrqzsogtyxriqqwnq.supabase.co/functions/v1/xero-sync',
        headers := jsonb_build_object('content-type', 'application/json',
                                      'x-cron-secret', (select secret from private.cron_secret where id = 1)),
        body := '{}'::jsonb)
    $job$);
  end if;
end $$;
