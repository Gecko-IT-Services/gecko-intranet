-- Phase 1 of the SharePoint → Supabase move
-- (docs/superpowers/specs/2026-10-07-supabase-migration-design.md).
--
-- Who gets in: a row in public.staff. Sign-in is Microsoft (Entra app
-- "Gecko Mileage Tracker", single tenant), handed to Supabase as an ID token,
-- so the email in the JWT is a Gecko tenant account. No table is ever created
-- in this schema without RLS on and a policy that calls is_gecko_staff().

create table public.staff (
  email      text primary key check (email = lower(email)),
  name       text not null,
  created_at timestamptz not null default now()
);

insert into public.staff (email, name) values
  ('philip@gecko-it.com', 'Philip Morris'),
  ('jack@gecko-it.com',   'Jack Morris');

alter table public.staff enable row level security;

-- security definer so policies can read staff without granting staff to anyone.
create function public.is_gecko_staff() returns boolean
  language sql stable security definer set search_path = ''
as $$
  select exists (
    select 1 from public.staff
    where email = lower(coalesce(auth.jwt() ->> 'email', ''))
  );
$$;
revoke all on function public.is_gecko_staff() from public;
grant execute on function public.is_gecko_staff() to authenticated;

create policy staff_read_self on public.staff
  for select to authenticated using (public.is_gecko_staff());

-- Keeps modified_at honest on every update (Projects' 21-day staleness reads it).
create function public.touch_modified_at() returns trigger
  language plpgsql set search_path = ''
as $$
begin
  new.modified_at := now();
  return new;
end;
$$;

-- GeckoProjects. Columns mirror the SharePoint list one for one.
create table public.projects (
  id            bigint generated always as identity primary key,
  title         text not null check (title <> ''),
  client_name   text not null default '',
  owner         text not null default '',
  status        text not null default 'Quoted'
                check (status in ('Quoted', 'Agreed', 'In progress', 'Done')),
  waiting_on    text not null default '',
  next_action   text not null default '',
  atera_ref     text not null default '',
  notes         text not null default '',
  -- SharePoint item id, set only by the import. Lets the import be re-run
  -- and lets anyone trace a row back to the list it came from.
  sharepoint_id text unique,
  created_at    timestamptz not null default now(),
  modified_at   timestamptz not null default now()
);

create trigger projects_touch before update on public.projects
  for each row execute function public.touch_modified_at();

alter table public.projects enable row level security;

create policy projects_staff_all on public.projects
  for all to authenticated
  using (public.is_gecko_staff())
  with check (public.is_gecko_staff());
