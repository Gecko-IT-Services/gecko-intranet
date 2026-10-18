-- Atera reconcile: what Gecko HQ can't read from a vendor, typed or ticked by staff (Philip, 18 Oct 2026).
--   kind 'in_use'  : Keeper users per client (quantity, optional unit_usd for the licence tier), Work from Home devices
--                    per client (devices = Atera machine names; quantity = how many)
--   kind 'covered' : what a flat-fee Xero line was priced on, per product (e.g. Cowans antivirus 17)
-- Design: docs/superpowers/specs/2026-10-18-atera-reconcile-design.md

create table public.atera_reconcile_inputs (
  client_name   text not null,
  product       text not null check (product in ('av', 'dns', 'backup', 'm365', 'wfh', 'keeper')),
  kind          text not null check (kind in ('in_use', 'covered')),
  quantity      numeric not null default 0 check (quantity >= 0),
  devices       jsonb not null default '[]',
  unit_usd      numeric,
  note          text not null default '',
  updated_by    text not null default '',
  modified_at   timestamptz not null default now(),
  primary key (client_name, product, kind)
);
create trigger atera_reconcile_inputs_touch before update on public.atera_reconcile_inputs
  for each row execute function public.touch_modified_at();
alter table public.atera_reconcile_inputs enable row level security;
create policy atera_reconcile_inputs_staff_all on public.atera_reconcile_inputs
  for all to authenticated using (public.is_gecko_staff()) with check (public.is_gecko_staff());

-- Keeper users and Work from Home devices as checked by hand on 18 Oct 2026 (Keeper console; Atera EndUser Remote list).
insert into public.atera_reconcile_inputs (client_name, product, kind, quantity, unit_usd, note, updated_by) values
  ('CDA Ltd', 'keeper', 'in_use', 5, 2.62, 'Keeper console, 18 Oct 2026', 'philip@gecko-it.com'),
  ('MSA Safety', 'keeper', 'in_use', 4, 5.60, 'Keeper console (Enterprise Plus), 18 Oct 2026', 'philip@gecko-it.com'),
  ('Haus Coast Ltd', 'keeper', 'in_use', 1, 2.62, 'Keeper console, 18 Oct 2026', 'philip@gecko-it.com')
on conflict do nothing;
