-- Contacts per client (Philip, 9 Oct 2026: improve contacts; "contacts per client" first).
-- Several people per client with role, email, phone and one main contact, shown on the client page.
-- Linked by name like the rest of the client data (client page matches names with sameClient).
-- Seeded once from the SSA list's primary contact + email, so every SSA client starts with one.
-- Design: docs/superpowers/specs/2026-10-09-client-contacts-design.md

create table public.client_contacts (
  id           bigint generated always as identity primary key,
  client_name  text not null check (client_name <> ''),
  name         text not null default '',
  role         text not null default '',          -- e.g. Owner, Accounts, Office manager, IT contact
  email        text not null default '',
  phone        text not null default '',
  is_main      boolean not null default false,     -- the person we deal with first
  notes        text not null default '',
  source       text not null default 'manual' check (source in ('manual', 'ssa', 'xero')),
  created_by   text not null default '',
  created_at   timestamptz not null default now(),
  modified_at  timestamptz not null default now(),
  check (name <> '' or email <> '')
);
create index client_contacts_client on public.client_contacts (lower(client_name));
-- One row per person per client (by email when there is one).
create unique index client_contacts_email on public.client_contacts (lower(client_name), lower(email)) where email <> '';
create trigger client_contacts_touch before update on public.client_contacts
  for each row execute function public.touch_modified_at();
alter table public.client_contacts enable row level security;
create policy client_contacts_staff_all on public.client_contacts
  for all to authenticated using (public.is_gecko_staff()) with check (public.is_gecko_staff());

insert into public.client_contacts (client_name, name, email, is_main, source, created_by)
select s.name, trim(s.primary_contact), lower(trim(s.email)), true, 'ssa', 'SSA list'
from public.ssa_clients s
where s.name <> '' and (trim(s.primary_contact) <> '' or trim(s.email) <> '')
on conflict do nothing;
