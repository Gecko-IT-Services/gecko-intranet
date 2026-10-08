-- Invoice an SSA renewal in Xero from Timesheets › SSA › Renew (Philip, 8 Oct 2026). Same
-- function and rules as Invoice in Xero on a job (a DRAFT, once per request key); a push now
-- says where it came from, and an SSA one which client and how many 10-hour blocks.
-- Design: docs/superpowers/specs/2026-10-08-xero-integration-design.md (phase 4)

alter table public.xero_pushes
  add column source        text not null default 'job' check (source in ('job', 'ssa')),
  add column ssa_client_id bigint references public.ssa_clients (id) on delete set null,
  add column quantity      numeric not null default 1 check (quantity > 0);
create index xero_pushes_ssa on public.xero_pushes (ssa_client_id);
