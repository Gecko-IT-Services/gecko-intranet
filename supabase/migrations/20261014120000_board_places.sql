-- Where a sticky sits in its whiteboard column when it was put there by hand (Jack, 14 Oct 2026:
-- "let me reorder stickies within a column").
-- Design: docs/superpowers/specs/2026-10-14-whiteboard-reorder-design.md
--
-- Kept apart from jobs and opportunities so that placing a sticky never touches their modified_at
-- (a deal's "quiet for 14 days" flag reads it). kind: 'job' (Jobs board), 'idea' (an opportunity in the
-- Jobs board's Ideas), 'deal' (Opportunities › Pipeline). col: the column it was placed in; once the
-- sticky is in another column the row no longer applies, so moving it elsewhere needs no write.
-- place 1 = top. Stickies without a row follow the placed ones, in the column's own order. A row for a
-- deleted job or deal is simply never matched.

create table public.board_places (
  kind   text not null check (kind in ('job', 'idea', 'deal')),
  ref_id bigint not null,
  col    text not null check (col <> ''),
  place  integer not null check (place > 0),
  primary key (kind, ref_id)
);

alter table public.board_places enable row level security;
create policy board_places_staff_all on public.board_places
  for all to authenticated using (public.is_gecko_staff()) with check (public.is_gecko_staff());
