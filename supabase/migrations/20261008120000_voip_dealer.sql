-- VoIP Unlimited: Gecko is both a reseller (Gecko bills the client; shows in service
-- lines) and a dealer (the client buys direct from VoIP Unlimited; Gecko earns monthly
-- commission, invoiced in Xero to the contact "Voip Unlimited"). This table is the
-- dealer side, so Opportunities stops offering VoxOne/connectivity to clients who
-- already have it, and raises renewals and VoIP Exchange migrations instead.
-- Seeded from Samuel Dacombe's "Client Action List" (11 Sep 2026) and Philip's
-- screenshot of the dealer customer list (8 Oct 2026). Maintained on the
-- Opportunities › VoIP Unlimited tab.

create table public.voip_dealer_services (
  id            bigint generated always as identity primary key,
  client_name   text not null check (client_name <> ''),  -- as the dashboard names the client
  vu_name       text not null default '',                 -- as VoIP Unlimited names them
  service       text not null default 'unknown' check (service in
                  ('voxone','voip_exchange','ethernet','leased_line','fttp','fttc','sogea','pstn','mobile','unknown')),
  quantity      int not null default 1 check (quantity >= 0),
  contract      text not null default 'unknown' check (contract in ('in_contract','out_of_contract','expiring','unknown')),
  contract_end  date,
  extras        text not null default '',                 -- e.g. "12 x maintenance, 1 x call recording"
  commission    numeric,                                  -- £/month to Gecko, if known
  notes         text not null default '',
  modified_at   timestamptz not null default now()
);

create trigger voip_dealer_services_touch before update on public.voip_dealer_services
  for each row execute function public.touch_modified_at();
alter table public.voip_dealer_services enable row level security;
create policy voip_dealer_services_staff_all on public.voip_dealer_services
  for all to authenticated using (public.is_gecko_staff()) with check (public.is_gecko_staff());

insert into public.voip_dealer_services (client_name, vu_name, service, quantity, contract, contract_end, extras, notes) values
 ('Daron Motors', 'Daron Motors Limited', 'ethernet', 1, 'out_of_contract', null, '100MB/100MB',
  'Samuel (11 Sep): straight renewal, or cease and reprovide as 1GB/1GB, likely cheaper; commission kept for a further 36 months.'),
 ('Daron Motors', 'Daron Motors Limited', 'voxone', 2, 'expiring', '2026-12-01', '', 'Samuel (11 Sep): 2 seats expire early December.'),
 ('Quality Mouldings', 'Quality Mouldings Ltd', 'voxone', 1, 'out_of_contract', null, '', 'Out of contract at £22/month; £15 on 36 months, £20 on 12 months.'),
 ('Brazier Interiors', 'Brazier Interior Systems Limited', 'voxone', 1, 'out_of_contract', null, '', 'Out of contract at £22/month; £15 on 36 months, £20 on 12 months.'),
 ('Freeston Water Treatment', 'Freeston Water Treatment Limited', 'voip_exchange', 12, 'out_of_contract', null, '12 x maintenance, 1 x call recording', ''),
 ('Waterside Homes', 'Waterside Homes Ltd', 'voip_exchange', 4, 'out_of_contract', null, '4 x maintenance, 3 x call recording', 'Not a Gecko IT client.'),
 ('Cowan Consultancy', 'Cowan Consultancy Limited', 'voip_exchange', 13, 'out_of_contract', null, 'no maintenance, 1 x mobile app', 'Philip (14 Sep): target first; two sites.'),
 ('PM Packing', 'P & M (packing) Limited', 'voip_exchange', 4, 'out_of_contract', null, '6 x maintenance across 7 seats', ''),
 ('PM Packing', 'P & M (packing) Limited', 'voip_exchange', 3, 'in_contract', null, '', ''),
 ('MSA Safety', 'MS Associates (Safety) Ltd', 'voip_exchange', 4, 'in_contract', null, '4 x maintenance', 'VoxOne move in progress (Sep 2026): £4/seat commission, £16/month.'),
 ('Onsite Commercial Services', 'Onsite Commercial Services Ltd', 'unknown', 1, 'unknown', null, '', 'On the dealer list; services not yet recorded.'),
 ('Access Instrumentation', 'Access Instrumentation Ltd', 'unknown', 1, 'unknown', null, '', 'On the dealer list; services not yet recorded.'),
 ('Hillcrest Engineering', 'Hillcrest Machinery and Engineering Ltd Portchester', 'unknown', 1, 'unknown', null, '', 'On the dealer list; services not yet recorded.'),
 ('Clarke Lane Engineering', 'Clarke Lane Engineering Limited', 'unknown', 1, 'unknown', null, '', 'On the dealer list; services not yet recorded.'),
 ('West Country Fires', 'West Country Fires Limited', 'unknown', 1, 'unknown', null, '', 'On the dealer list; services not yet recorded.'),
 ('Cutler Home Solutions', 'Cutler Home Solutions Limited', 'unknown', 1, 'unknown', null, '', 'Not a Gecko IT client.'),
 ('Mr Bobby Biggs', 'Mr Bobby Biggs', 'unknown', 1, 'unknown', null, '', 'Residential.'),
 ('Mr and Mrs Hobbs', 'Mr and Mrs Hobbs', 'unknown', 1, 'unknown', null, '', 'Residential.');

-- Three dealer-side opportunity types.
alter table public.opportunity_products drop constraint opportunity_products_rule_check;
alter table public.opportunity_products add constraint opportunity_products_rule_check check (rule in
  ('missing','missing_if_m365','m365_elsewhere','email_filter','dmarc','hosting','seo','website','support','devices',
   'voip_exchange','dealer_renewal','dealer_prospect'));

insert into public.opportunity_products
  (key, family, name, rule, keywords, ticket_keywords, pitch, unit_note, default_mrr, default_one_off, email_subject, email_body, sort, active)
values
('ve_migration', 'Communications', 'VoIP Exchange → VoxOne migration', 'voip_exchange', '', 'call recording|recording|mobile app|softphone',
 'Move VoIP Exchange seats to VoxOne: recordings and the app work again; commission £4 per seat.',
 'Dealer commission £4.00 per seat / month (value = seats × this)', 4, null,
 'Your phone system: moving to VoxOne',
 $t$Hi {{first_name}},

VoIP Unlimited are moving customers from VoIP Exchange to their newer VoxOne platform, and we'd like to plan {{client}}'s move with you rather than leave it to chance:

{{evidence}}

VoxOne keeps your numbers, works on desk phones, mobiles and laptops, and call recording works again. Seats are £15 a month on a 36-month term (£20 on 12 months), against £22 for out-of-contract seats.

Can we book 15 minutes to go through your extensions and pick a date?

{{sender}}$t$, 12, true),

('vu_renewal', 'Connectivity', 'VoIP Unlimited renewal / upgrade', 'dealer_renewal', '', '',
 'Out-of-contract or expiring lines and seats: renew or upgrade, usually cheaper, and keep the commission for 36 months.',
 'Commission kept for a further 36 months', null, null,
 'Your phone and internet contracts with VoIP Unlimited',
 $t$Hi {{first_name}},

We've reviewed {{client}}'s services with VoIP Unlimited and some are out of contract, which usually means paying more than you need to:

{{evidence}}

We can renew these on current pricing, or upgrade where it makes sense, often for less than you pay today. Shall I get the quotes together?

{{sender}}$t$, 14, true),

('it_services', 'Support', 'IT support for a VoIP Unlimited customer', 'dealer_prospect', '', '',
 'Already trusts us for phones/connectivity; not yet an IT client.',
 'Hours block, retainer or managed service', null, null,
 'Looking after {{client}}''s IT as well',
 $t$Hi {{first_name}},

We already look after {{client}}'s phones and connectivity with VoIP Unlimited. Many of our customers also have us look after their IT: Microsoft 365, security, backups and day-to-day support, with one number to call for everything.

{{evidence}}

Would a short chat about how you handle IT today be useful?

{{sender}}$t$, 135, true);
