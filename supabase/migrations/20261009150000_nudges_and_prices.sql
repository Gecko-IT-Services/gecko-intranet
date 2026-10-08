-- Philip, 8 Oct 2026:
-- 1. "Nudge" on Jobs › Owed to us drafts a friendly payment reminder in the person's own Outlook
--    Drafts (never sent by the portal). Each one is logged here so the row shows when a client was
--    last nudged and nobody chases twice by accident.
-- 2. Opportunity emails quote the client's price ("Hornetsecurity is £7.50 per user a month").
--    unit_price is what the client pays per price_unit; it is separate from default_mrr, which is
--    the pipeline value (for dealer products, Gecko's commission) and is never quoted.
-- Design: docs/superpowers/specs/2026-10-09-nudge-and-prices-design.md

create table public.payment_nudges (
  id               bigint generated always as identity primary key,
  contact_id       text not null default '',          -- Xero ContactID
  contact_name     text not null,
  invoice_numbers  text[] not null default '{}',
  amount_due       numeric not null default 0,        -- £ incl. VAT across those invoices, when drafted
  recipient        text not null default '',          -- '' = no email in Xero, added by hand in Outlook
  created_by       text not null default '',
  created_at       timestamptz not null default now()
);
create index payment_nudges_contact on public.payment_nudges (contact_name, created_at desc);
alter table public.payment_nudges enable row level security;
create policy payment_nudges_staff_all on public.payment_nudges
  for all to authenticated using (public.is_gecko_staff()) with check (public.is_gecko_staff());

alter table public.opportunity_products
  add column unit_price numeric check (unit_price is null or unit_price >= 0),
  add column price_unit text not null default 'user'
    check (price_unit in ('user', 'seat', 'device', 'site', 'month', 'year', 'one-off'));

-- Prices Philip has given (8 Oct) or noted on the product; the rest are set on the Products tab.
update public.opportunity_products set unit_price = 7.50, price_unit = 'user'   where key = 'email_security';
update public.opportunity_products set unit_price = 1.40, price_unit = 'user'   where key = 'exclaimer';
update public.opportunity_products set unit_price = 15.00, price_unit = 'seat'  where key = 'voxone';
update public.opportunity_products set price_unit = 'device'  where key in ('endpoint');
update public.opportunity_products set price_unit = 'month'   where key in ('seo', 'support', 'it_services', 'vu_renewal', 'connectivity');
update public.opportunity_products set price_unit = 'year'    where key = 'hosting';
update public.opportunity_products set price_unit = 'one-off' where key in ('email_auth', 'website', 'windows11');
update public.opportunity_products set price_unit = 'seat'    where key = 've_migration';

-- How many users / seats / devices an opportunity is for: with a per-unit price it gives the total.
alter table public.opportunities add column quantity numeric check (quantity is null or quantity >= 0);
