-- Atera costs (Philip, 10 Oct 2026: "the costing is the bit that upsets me… it's expensive"). Clients › Atera.
-- Design: docs/superpowers/specs/2026-10-12-atera-costs-design.md
--
-- atera_bills: what Atera charged Gecko, one row per charge (technician seats on the 26th, AppCenter add-ons on the
--   10th), in the month it was charged (Philip's rule: everything sits in the month it was invoiced). Seeded below from
--   the BlueSnap receipts (USD) and PayPal receipts (GBP actually paid) in philip@'s mailbox; later months are added by
--   the page from the daily feed's `atera` section (GBP then at the feed's rate, gbp_source = 'rate').
-- atera_usage / atera_usage_files: Atera's per-customer AppCenter usage report (Acronis, Webroot, Keeper, …) uploaded
--   on the page. A file is only saved when its lines add up to that month's add-ons charge (save_atera_usage checks it),
--   and it replaces the month as a whole: nothing is half-applied.

create table public.atera_bills (
  id          bigserial primary key,
  month       text not null check (month ~ '^\d{4}-\d{2}$'),
  charged_on  date not null,
  kind        text not null check (kind in ('seats', 'addons')),
  product     text not null default '',
  usd         numeric(10,2) not null,
  gbp         numeric(10,2),
  gbp_source  text not null default 'paid' check (gbp_source in ('paid', 'rate')),
  ref         text not null default '',
  created_at  timestamptz not null default now(),
  unique (charged_on, kind)
);

insert into public.atera_bills (month, charged_on, kind, product, usd, gbp, ref) values
  ('2026-06', '2026-06-10', 'addons', 'AppCenter AppCenter-UsageBased-M', 650.73, 508.66, 'BlueSnap 390074059'),
  ('2026-06', '2026-06-26', 'seats',  'Atera SD-Enterprise_0225-M (2)',   378.00, 299.54, 'BlueSnap 400780889'),
  ('2026-07', '2026-07-10', 'addons', 'AppCenter AppCenter-UsageBased-M', 698.49, 544.03, 'BlueSnap 410648761'),
  ('2026-07', '2026-07-26', 'seats',  'Atera SD-Enterprise_0225-M (2)',   378.00, 296.34, 'BlueSnap 420747673'),
  ('2026-08', '2026-08-10', 'addons', 'AppCenter AppCenter-UsageBased-M', 704.61, 546.47, 'BlueSnap 428544377'),
  ('2026-08', '2026-08-26', 'seats',  'Atera SD-Enterprise_0225-M (2)',   378.00, 289.20, 'BlueSnap 436984925'),
  ('2026-09', '2026-09-10', 'addons', 'AppCenter AppCenter-UsageBased-M', 711.29, 547.73, 'BlueSnap 443676345'),
  ('2026-09', '2026-09-26', 'seats',  'Atera SD-Enterprise_0225-M (2)',   378.00, 298.18, 'BlueSnap 446796753'),
  ('2026-10', '2026-10-10', 'addons', 'AppCenter AppCenter-UsageBased-M', 721.43, 569.22, 'BlueSnap 449265387');

create table public.atera_usage_files (
  month        text primary key check (month ~ '^\d{4}-\d{2}$'),
  file_name    text not null default '',
  rows         int not null default 0,
  total_usd    numeric(10,2) not null,
  bill_usd     numeric(10,2) not null,
  columns      jsonb not null default '{}',   -- which column held customer / product / quantity / amount
  uploaded_by  text not null default '',
  uploaded_at  timestamptz not null default now()
);

create table public.atera_usage (
  id         bigserial primary key,
  month      text not null references public.atera_usage_files (month) on delete cascade,
  row_no     int not null,
  customer   text not null default '',
  product    text not null default '',
  feature    text not null default 'other',
  quantity   numeric(12,3),
  usd        numeric(10,2) not null,
  created_at timestamptz not null default now()
);
create index atera_usage_month on public.atera_usage (month);

alter table public.atera_bills enable row level security;
alter table public.atera_usage_files enable row level security;
alter table public.atera_usage enable row level security;
create policy atera_bills_staff_read on public.atera_bills for select to authenticated using (public.is_gecko_staff());
-- The page adds the feed's month; it never edits or deletes a charge.
create policy atera_bills_staff_insert on public.atera_bills for insert to authenticated with check (public.is_gecko_staff());
create policy atera_usage_files_staff_read on public.atera_usage_files for select to authenticated using (public.is_gecko_staff());
create policy atera_usage_staff_read on public.atera_usage for select to authenticated using (public.is_gecko_staff());

-- Saves one month's usage report in one go, or not at all. Refuses a file whose lines don't add up to that month's
-- add-ons charge (to the cent, ±$1.00 for Atera's rounding), so a wrong or partial file can never be shown as the cost.
create function public.save_atera_usage(p_month text, p_file_name text, p_columns jsonb, p_rows jsonb)
  returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_bill  numeric;
  v_total numeric;
  v_count int;
begin
  if not public.is_gecko_staff() then raise exception 'Not allowed'; end if;
  if p_month !~ '^\d{4}-\d{2}$' then raise exception 'Bad month %', p_month; end if;
  select sum(usd) into v_bill from public.atera_bills where month = p_month and kind = 'addons';
  if v_bill is null then raise exception 'No Atera add-ons charge for % to check the file against', p_month; end if;
  select coalesce(sum((r->>'usd')::numeric), 0), count(*) into v_total, v_count from jsonb_array_elements(p_rows) r;
  if v_count = 0 then raise exception 'The file has no usage lines'; end if;
  if abs(v_total - v_bill) > 1.00 then
    raise exception 'The file adds up to $% but Atera charged $% for %: not saved', v_total, v_bill, p_month;
  end if;
  delete from public.atera_usage_files where month = p_month;
  insert into public.atera_usage_files (month, file_name, rows, total_usd, bill_usd, columns, uploaded_by)
    values (p_month, left(coalesce(p_file_name, ''), 200), v_count, v_total, v_bill, coalesce(p_columns, '{}'),
            lower(coalesce(auth.jwt() ->> 'email', '')));
  insert into public.atera_usage (month, row_no, customer, product, feature, quantity, usd)
    select p_month, (r->>'row_no')::int, left(coalesce(r->>'customer', ''), 200), left(coalesce(r->>'product', ''), 300),
           coalesce(nullif(r->>'feature', ''), 'other'), nullif(r->>'quantity', '')::numeric, (r->>'usd')::numeric
    from jsonb_array_elements(p_rows) r;
  return jsonb_build_object('ok', true, 'rows', v_count, 'total_usd', v_total, 'bill_usd', v_bill);
end $$;
revoke all on function public.save_atera_usage(text, text, jsonb, jsonb) from public;
grant execute on function public.save_atera_usage(text, text, jsonb, jsonb) to authenticated;
