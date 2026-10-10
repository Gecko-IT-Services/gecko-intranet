-- Ask Gecko HQ was removed the same day it was added (Philip, 11 Oct 2026: no paid AI). Its log never held a row.
-- Design note: docs/superpowers/specs/2026-10-11-ask-gecko-hq-design.md
drop table if exists public.ask_log;
