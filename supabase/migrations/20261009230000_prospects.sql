-- Prospects: new business that isn't a client yet (Philip, 9 Oct 2026: last of the contacts/sales improvements).
-- Company, contact, where they came from, what they're interested in, stage, next step and follow-up.
-- "Make client" adds them to Clients (gecko_clients, status New) with their contact and a first activity line.
-- Design: docs/superpowers/specs/2026-10-09-prospects-design.md

create table public.prospects (
  id               bigint generated always as identity primary key,
  company          text not null check (company <> ''),
  contact_name     text not null default '',
  email            text not null default '',
  phone            text not null default '',
  source           text not null default 'other'
                     check (source in ('referral', 'website', 'voip_dealer', 'networking', 'existing_contact', 'cold', 'other')),
  interest         text not null default '',        -- e.g. IT support, Microsoft 365, VoxOne
  stage            text not null default 'new'
                     check (stage in ('new', 'contacted', 'meeting', 'proposal', 'won', 'lost')),
  est_mrr          numeric not null default 0 check (est_mrr >= 0),   -- £/month if they sign
  next_step        text not null default '',
  follow_up_on     date,
  notes            text not null default '',
  converted_client text not null default '',        -- the client name once they became a client
  converted_at     timestamptz,
  created_by       text not null default '',
  created_at       timestamptz not null default now(),
  modified_at      timestamptz not null default now()
);
create index prospects_stage on public.prospects (stage);
create trigger prospects_touch before update on public.prospects
  for each row execute function public.touch_modified_at();
alter table public.prospects enable row level security;
create policy prospects_staff_all on public.prospects
  for all to authenticated using (public.is_gecko_staff()) with check (public.is_gecko_staff());
