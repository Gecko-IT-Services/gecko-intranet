-- Client details (Philip, 9 Oct 2026): address with a map, office number to call from VoxOne, website, how to find
-- them, and a proper conversation log (date and time, how long, which way).
-- Design: docs/superpowers/specs/2026-10-10-client-details-design.md

create table public.client_profiles (
  id            bigint generated always as identity primary key,
  client_name   text not null check (client_name <> ''),
  address_line1 text not null default '',
  address_line2 text not null default '',
  town          text not null default '',
  county        text not null default '',
  postcode      text not null default '',
  lat           numeric,                         -- from the postcode (postcodes.io), for the map
  lon           numeric,
  office_phone  text not null default '',
  website       text not null default '',
  visit_notes   text not null default '',        -- parking, which door, opening hours. Never passwords or alarm codes.
  modified_by   text not null default '',
  created_at    timestamptz not null default now(),
  modified_at   timestamptz not null default now()
);
create unique index client_profiles_client on public.client_profiles (lower(client_name));
create trigger client_profiles_touch before update on public.client_profiles
  for each row execute function public.touch_modified_at();
alter table public.client_profiles enable row level security;
create policy client_profiles_staff_all on public.client_profiles
  for all to authenticated using (public.is_gecko_staff()) with check (public.is_gecko_staff());

-- Conversations: when it happened (not just when it was typed in), how long, and which way.
alter table public.client_activity
  add column happened_at  timestamptz,
  add column duration_min integer check (duration_min is null or (duration_min >= 0 and duration_min <= 1440)),
  add column direction    text not null default '' check (direction in ('', 'in', 'out'));
update public.client_activity set happened_at = created_at where happened_at is null;
alter table public.client_activity alter column happened_at set default now();
alter table public.client_activity alter column happened_at set not null;
