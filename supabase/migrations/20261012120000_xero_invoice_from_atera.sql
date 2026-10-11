-- "Bill in Xero" on a leak in Clients › Atera (Philip, 11 Oct 2026: "if the customer should be paying for it then there
-- should be a prompt to do so that takes it through to Xero"). Same xero-invoice function and rules as Jobs and SSA:
-- a DRAFT only, once per request key, contacts and items already used in Xero. `leak_ref` ties the draft to the leak
-- ("YYYY-MM|client|kind|feature") so the page shows it as dealt with. Design: 2026-10-12-atera-costs-design.md
alter table public.xero_pushes drop constraint if exists xero_pushes_source_check;
alter table public.xero_pushes add constraint xero_pushes_source_check check (source in ('job', 'ssa', 'atera'));
alter table public.xero_pushes add column leak_ref text not null default '';
create index xero_pushes_leak on public.xero_pushes (leak_ref) where leak_ref <> '';
