-- Machines left out of a client's advice emails (Philip, 19 Oct 2026: ENGINEER-HP2 at Cowans is the Windows 7 PC kept for TimFram,
-- and only a whole topic could be unticked). Unticking a machine on Upgrades & advice adds its Atera name here; ticking it again
-- takes it out. Kept with the client's note so the note itself stays background, not instructions.
-- Design: docs/superpowers/specs/2026-10-19-advice-facts-and-checks-design.md
alter table public.client_notes add column left_out text[] not null default '{}';
