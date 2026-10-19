-- SEO (Philip, 19 Oct 2026: "add an SEO section… ALS and Clarke Lane use us for SEO so we need to stay on top of it for them, clarke lane
-- is yet to go active, CDA to hopefully follow"). Sites we look after, a weekly health check of each, and a log of the work done each
-- month. Design: docs/superpowers/specs/2026-10-20-seo-design.md
create table public.seo_sites (
  id              bigint generated always as identity primary key,
  client_name     text not null check (client_name <> ''),
  domain          text not null unique check (domain <> ''),
  status          text not null default 'setup' check (status in ('active', 'setup', 'proposed', 'paused')),
  keywords        text not null default '',   -- what they want to be found for, one per line
  notes           text not null default '',
  started_on      date,
  created_by      text not null default '',
  created_at      timestamptz not null default now(),
  modified_at     timestamptz not null default now()
);
create trigger seo_sites_touch before update on public.seo_sites for each row execute function public.touch_modified_at();

-- One row per check (Edge Function seo-check, weekly and on demand): what the home page says to Google, and Google's own scores when a
-- PageSpeed key is set (secret PAGESPEED_API_KEY).
create table public.seo_checks (
  id              bigint generated always as identity primary key,
  site_id         bigint not null references public.seo_sites(id) on delete cascade,
  checked_at      timestamptz not null default now(),
  onpage          jsonb not null default '{}',
  pagespeed       jsonb,
  error           text not null default ''
);
create index seo_checks_latest on public.seo_checks (site_id, checked_at desc);

-- What was done for the client, and when: the record that the monthly fee is earned.
create table public.seo_work (
  id              bigint generated always as identity primary key,
  site_id         bigint not null references public.seo_sites(id) on delete cascade,
  done_on         date not null default current_date,
  what            text not null check (what <> ''),
  minutes         int,
  done_by         text not null default '',
  created_at      timestamptz not null default now()
);
create index seo_work_site on public.seo_work (site_id, done_on desc);

alter table public.seo_sites enable row level security;
alter table public.seo_checks enable row level security;
alter table public.seo_work enable row level security;
create policy seo_sites_staff_all on public.seo_sites for all to authenticated using (public.is_gecko_staff()) with check (public.is_gecko_staff());
create policy seo_checks_staff_read on public.seo_checks for select to authenticated using (public.is_gecko_staff());
create policy seo_work_staff_all on public.seo_work for all to authenticated using (public.is_gecko_staff()) with check (public.is_gecko_staff());

-- Where things stand on 19 Oct 2026: ALS billed monthly since August (Xero), Clarke Lane setting up, CDA hoped for.
insert into public.seo_sites (client_name, domain, status, started_on, created_by) values
  ('ALS Locksmiths', 'newforestlocksmith.com', 'active', '2026-08-01', 'Philip (19 Oct 2026)'),
  ('Clarke Lane Engineering', 'clarke-lane.co.uk', 'setup', null, 'Philip (19 Oct 2026)'),
  ('CDA Ltd', 'cdaluminium.uk.com', 'proposed', null, 'Philip (19 Oct 2026)');

-- Mondays 05:33 UTC, after the domain check, before the Monday brief.
do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') and exists (select 1 from pg_extension where extname = 'pg_net') then
    perform cron.schedule('seo-check', '33 5 * * 1', $job$
      select net.http_post(
        url := 'https://nkobrqzsogtyxriqqwnq.supabase.co/functions/v1/seo-check',
        headers := jsonb_build_object('content-type', 'application/json',
                                      'x-cron-secret', (select secret from private.cron_secret where id = 1)),
        body := '{}'::jsonb,
        timeout_milliseconds := 150000)
    $job$);
  end if;
end $$;
