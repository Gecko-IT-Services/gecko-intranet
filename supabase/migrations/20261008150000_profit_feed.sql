-- The profitability feed, moved from Gecko Dashboard Data/profitability-feed.json in
-- SharePoint Documents. One row (id = 1) holding the whole feed exactly as the file
-- held it, so src/core/profit-feed.js validates it unchanged.
-- Written only by Philip's scheduled Claude task through the Supabase connector (an
-- upsert, see 2026-10-08-feed-on-supabase-design.md); the site only reads it.

create table public.profit_feed (
  id           smallint primary key default 1 check (id = 1),
  data         jsonb not null,
  modified_at  timestamptz not null default now()
);

create trigger profit_feed_touch before update on public.profit_feed
  for each row execute function public.touch_modified_at();
alter table public.profit_feed enable row level security;
create policy profit_feed_staff_read on public.profit_feed
  for select to authenticated using (public.is_gecko_staff());
