-- Google Search Console for the SEO page (Philip, 20 Oct 2026: "happy to proceed"): which searches find each SEO site, clicks,
-- impressions and average position. Connected once with Philip's Google sign-in (read only: webmasters.readonly); a daily sync fills the
-- tables below. Secrets GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET (Supabase › Edge Functions › Secrets). Tokens in schema private.
-- Design: docs/superpowers/specs/2026-10-20-search-console-design.md
create table private.google_tokens (
  id               int primary key default 1 check (id = 1),
  refresh_token    text not null,
  access_token     text not null default '',
  access_expires   timestamptz,
  scopes           text not null default '',
  google_email     text not null default '',
  connected_by     text not null default '',
  connected_at     timestamptz not null default now()
);
create table private.google_oauth_states (
  state       text primary key,
  email       text not null,
  created_at  timestamptz not null default now()
);

-- What the site shows about the connection (no tokens).
create table public.google_status (
  id            int primary key default 1 check (id = 1),
  connected     boolean not null default false,
  google_email  text not null default '',
  properties    jsonb not null default '[]',   -- the Search Console properties the account can see
  last_sync_at  timestamptz,
  last_sync_ok  boolean,
  last_error    text not null default ''
);
insert into public.google_status (id) values (1);

-- Clicks, impressions, CTR and average position per site per day (last 16 months as Google keeps them; ~90 days synced each time).
create table public.seo_search_days (
  site_id       bigint not null references public.seo_sites(id) on delete cascade,
  day           date not null,
  clicks        int not null default 0,
  impressions   int not null default 0,
  ctr           numeric not null default 0,
  position      numeric,
  primary key (site_id, day)
);
-- The searches that found each site over the last 28 days (top 50), replaced on every sync.
create table public.seo_search_queries (
  site_id       bigint not null references public.seo_sites(id) on delete cascade,
  query         text not null,
  clicks        int not null default 0,
  impressions   int not null default 0,
  ctr           numeric not null default 0,
  position      numeric,
  period_end    date not null,
  primary key (site_id, query)
);
alter table public.google_status enable row level security;
alter table public.seo_search_days enable row level security;
alter table public.seo_search_queries enable row level security;
create policy google_status_staff_read on public.google_status for select to authenticated using (public.is_gecko_staff());
create policy seo_search_days_staff_read on public.seo_search_days for select to authenticated using (public.is_gecko_staff());
create policy seo_search_queries_staff_read on public.seo_search_queries for select to authenticated using (public.is_gecko_staff());

-- Daily at 06:13 UTC (Search Console's figures run about two days behind; once a day is plenty).
do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') and exists (select 1 from pg_extension where extname = 'pg_net') then
    perform cron.schedule('gsc-sync', '13 6 * * *', $job$
      select net.http_post(
        url := 'https://nkobrqzsogtyxriqqwnq.supabase.co/functions/v1/gsc-sync',
        headers := jsonb_build_object('content-type', 'application/json',
                                      'x-cron-secret', (select secret from private.cron_secret where id = 1)),
        body := '{}'::jsonb,
        timeout_milliseconds := 120000)
    $job$);
  end if;
end $$;
