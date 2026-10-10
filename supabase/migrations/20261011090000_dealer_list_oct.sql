-- VoIP Unlimited dealer list, from the account manager's "Gecko IT - Dealer Customers (Commission)" sheet (email
-- "Customer List", 10 Oct 2026). Replaces the rows for the 15 customers on it; Mr and Mrs Hobbs (not on the sheet)
-- are left as they were. Commission is the sheet's fixed monthly commission per line (total £613.50); call-usage
-- commission is not on the sheet. Design: docs/superpowers/specs/2026-10-11-dealer-list-design.md
--
-- Philip (11 Oct): Cowan Consultancy has already moved to VoxOne; MSA Safety's upgrade is booked for 29 Oct. Both
-- are recorded as VoxOne so no VoIP Exchange migration is raised for them.

delete from public.voip_dealer_services where client_name in (
  'MSA Safety', 'Cutler Home Solutions', 'Onsite Commercial Services', 'Access Instrumentation', 'Hillcrest Engineering',
  'Mr Bobby Biggs', 'Quality Mouldings', 'Brazier Interiors', 'West Country Fires', 'PM Packing', 'Clarke Lane Engineering',
  'Cowan Consultancy', 'Daron Motors', 'Waterside Homes', 'Freeston Water Treatment');

insert into public.voip_dealer_services (client_name, vu_name, service, quantity, contract, contract_end, extras, commission, notes) values
 ('MSA Safety', 'MS Associates (Safety) Ltd', 'voxone', 4, 'in_contract', null, '', 16,
  'Upgrade from VoIP Exchange signed off; booked for 29 Oct 2026 (Philip, 11 Oct).'),
 ('MSA Safety', 'MS Associates (Safety) Ltd', 'sogea', 1, 'unknown', null, '80/20', 3, ''),
 ('Cutler Home Solutions', 'Cutler Home Solutions Limited', 'voxone', 1, 'unknown', null, '', 4, 'Not a Gecko IT client.'),
 ('Onsite Commercial Services', 'Onsite Commercial Services Ltd', 'voxone', 12, 'unknown', null, '', 48, ''),
 ('Onsite Commercial Services', 'Onsite Commercial Services Ltd', 'sogea', 1, 'unknown', null, '80/20', 3, ''),
 ('Access Instrumentation', 'Access Instrumentation Ltd', 'voxone', 3, 'unknown', null, '', 12, ''),
 ('Hillcrest Engineering', 'Hillcrest Machinery and Engineering Ltd Portchester', 'voxone', 6, 'unknown', null, '', 24, ''),
 ('Hillcrest Engineering', 'Hillcrest Machinery and Engineering Ltd Portchester', 'fttp', 1, 'unknown', null, '900/900', 2, ''),
 ('Mr Bobby Biggs', 'Mr Bobby Biggs', 'voxone', 1, 'unknown', null, '', 4, 'Residential.'),
 ('Quality Mouldings', 'Quality Mouldings Ltd', 'voxone', 1, 'out_of_contract', null, '', 4,
  'Out of contract at £22/month; £15 on 36 months, £20 on 12 months.'),
 ('Quality Mouldings', 'Quality Mouldings Ltd', 'sogea', 1, 'unknown', null, '80/20', 3, ''),
 ('Brazier Interiors', 'Brazier Interior Systems Limited', 'voxone', 1, 'out_of_contract', null, '', 4,
  'Out of contract at £22/month; £15 on 36 months, £20 on 12 months.'),
 ('Brazier Interiors', 'Brazier Interior Systems Limited', 'fttc', 1, 'unknown', null, '80/20', 5, ''),
 ('Brazier Interiors', 'Brazier Interior Systems Limited', 'pstn', 1, 'unknown', null, '', null, ''),
 ('West Country Fires', 'West Country Fires Limited', 'voxone', 8, 'unknown', null, '', 32, ''),
 ('West Country Fires', 'West Country Fires Limited', 'fttc', 1, 'unknown', null, '80/20', 5, ''),
 ('West Country Fires', 'West Country Fires Limited', 'fttp', 1, 'unknown', null, '1GB/115', 3, ''),
 ('PM Packing', 'P & M (packing) Limited', 'voip_exchange', 4, 'out_of_contract', null, '6 x maintenance across 7 seats', 35.5,
  'Commission is the sheet total for all 7 seats; but 7 × £3.50 + 6 maintenance × £3 = £42.50. Check with VoIP Unlimited which is right.'),
 ('PM Packing', 'P & M (packing) Limited', 'voip_exchange', 3, 'in_contract', null, '', null, 'Commission included in the row above.'),
 ('PM Packing', 'P & M (packing) Limited', 'fttp', 1, 'unknown', null, '550/75', 0, ''),
 ('Clarke Lane Engineering', 'Clarke Lane Engineering Limited', 'voxone', 4, 'unknown', null, '', 16, ''),
 ('Clarke Lane Engineering', 'Clarke Lane Engineering Limited', 'fttc', 1, 'unknown', null, '80/20', 5, ''),
 ('Clarke Lane Engineering', 'Clarke Lane Engineering Limited', 'pstn', 1, 'unknown', null, '', null, ''),
 ('Cowan Consultancy', 'Cowan Consultancy Limited', 'voxone', 13, 'in_contract', null, '', 52,
  'Moved from VoIP Exchange to VoxOne (Philip, 11 Oct). Two sites.'),
 ('Cowan Consultancy', 'Cowan Consultancy Limited', 'fttc', 1, 'unknown', null, '40/10', 3, ''),
 ('Cowan Consultancy', 'Cowan Consultancy Limited', 'fttp', 1, 'unknown', null, '80/20', 3, ''),
 ('Cowan Consultancy', 'Cowan Consultancy Limited', 'ethernet', 1, 'unknown', null, '1GB/1GB', 50, ''),
 ('Daron Motors', 'Daron Motors Limited', 'voxone', 18, 'in_contract', null, '', 72, ''),
 ('Daron Motors', 'Daron Motors Limited', 'voxone', 2, 'expiring', '2026-12-01', '', 8, 'Samuel (11 Sep): 2 seats expire early December.'),
 ('Daron Motors', 'Daron Motors Limited', 'ethernet', 1, 'in_contract', null, '1GB/1GB', 50, ''),
 ('Daron Motors', 'Daron Motors Limited', 'ethernet', 1, 'out_of_contract', null, '100MB/100MB', 40,
  'Samuel (11 Sep): straight renewal, or cease and reprovide as 1GB/1GB, likely cheaper; commission kept for a further 36 months.'),
 ('Waterside Homes', 'Waterside Homes Ltd', 'voip_exchange', 4, 'out_of_contract', null, '4 x maintenance, 3 x call recording', 26,
  'Not a Gecko IT client.'),
 ('Freeston Water Treatment', 'Freeston Water Treatment Limited', 'voip_exchange', 12, 'out_of_contract', null, '12 x maintenance, 1 x call recording', 78, ''),
 ('Freeston Water Treatment', 'Freeston Water Treatment Limited', 'sogea', 1, 'unknown', null, '80/20', 3, '');
