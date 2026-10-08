-- Activity & follow-ups per client (Philip, 9 Oct 2026: second of the contacts/sales improvements).
-- A quick note of a call, email, meeting or visit on the client page, optionally with a follow-up date.
-- Follow-ups due show on Overview › Today until they are marked done.
-- Design: docs/superpowers/specs/2026-10-09-client-activity-design.md

create table public.client_activity (
  id             bigint generated always as identity primary key,
  client_name    text not null check (client_name <> ''),
  kind           text not null default 'note' check (kind in ('note', 'call', 'email', 'meeting', 'visit')),
  body           text not null check (body <> ''),
  contact_id     bigint references public.client_contacts(id) on delete set null,
  contact_name   text not null default '',          -- kept if the contact is later removed
  follow_up_on   date,                              -- null = nothing to follow up
  follow_up_done_at timestamptz,
  follow_up_done_by text not null default '',
  created_by     text not null default '',
  created_at     timestamptz not null default now(),
  modified_at    timestamptz not null default now()
);
create index client_activity_client on public.client_activity (lower(client_name), created_at desc);
create index client_activity_due on public.client_activity (follow_up_on) where follow_up_on is not null and follow_up_done_at is null;
create trigger client_activity_touch before update on public.client_activity
  for each row execute function public.touch_modified_at();
alter table public.client_activity enable row level security;
create policy client_activity_staff_all on public.client_activity
  for all to authenticated using (public.is_gecko_staff()) with check (public.is_gecko_staff());
