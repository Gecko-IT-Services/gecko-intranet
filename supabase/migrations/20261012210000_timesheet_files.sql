-- Files attached to timesheet entries (Jack, 12 Oct 2026). The file itself is in SharePoint (the
-- Gecko Docs library on the portal site); this is the record of which entry it belongs to and where
-- it is, so the entries table can show a paperclip without asking SharePoint about every entry.
-- Design: docs/superpowers/specs/2026-10-12-timesheet-files-design.md
--
-- Removing a file deletes its row (the file goes to SharePoint's recycle bin). An entry is never
-- hard-deleted (deleted_at), so the reference has no cascade: a row here keeps its entry.

create table public.timesheet_files (
  id           bigint generated always as identity primary key,
  entry_id     bigint not null references public.timesheet_entries(id),
  name         text not null check (name <> ''),      -- as picked; SharePoint's own name carries the date and entry
  size         bigint not null default 0,              -- bytes
  drive_id     text not null,                          -- the Gecko Docs library
  item_id      text not null,                          -- the file in it
  web_url      text not null default '',
  uploaded_by  text not null default '',
  created_at   timestamptz not null default now(),
  unique (drive_id, item_id)
);
create index timesheet_files_entry on public.timesheet_files (entry_id);

alter table public.timesheet_files enable row level security;
create policy timesheet_files_staff_all on public.timesheet_files
  for all to authenticated using (public.is_gecko_staff()) with check (public.is_gecko_staff());
