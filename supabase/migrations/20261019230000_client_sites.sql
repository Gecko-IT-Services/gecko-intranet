-- A client's sites by name (Philip, 19 Oct 2026: network drawing per client). Gecko HQ finds the sites from Atera (machines sharing an
-- internet address); a name typed once ("Whiteley office") is kept here against that address. Design: 2026-10-19-client-network-design.md
create table public.client_sites (
  client_name   text not null,
  site_key      text not null,          -- the internet address (IPv4, or an IPv6 /48 prefix) the site is known by
  name          text not null check (name <> ''),
  updated_by    text not null default '',
  modified_at   timestamptz not null default now(),
  primary key (client_name, site_key)
);
create trigger client_sites_touch before update on public.client_sites for each row execute function public.touch_modified_at();
alter table public.client_sites enable row level security;
create policy client_sites_staff_all on public.client_sites
  for all to authenticated using (public.is_gecko_staff()) with check (public.is_gecko_staff());
