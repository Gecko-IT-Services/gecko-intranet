-- Tasks: client promises and handing work over (Jack, 12 Oct 2026).
-- One line of what needs doing, who does it, when it is due and usually which client. Shown on
-- Overview › Today and the client page; a client note's follow-up makes one.
-- Design: docs/superpowers/specs/2026-10-12-tasks-design.md

create table public.tasks (
  id           bigint generated always as identity primary key,
  title        text not null check (title <> ''),
  note         text not null default '',
  client_name  text not null default '',                 -- '' = not about one client
  assigned_to  text not null check (assigned_to <> ''),  -- 'Philip' | 'Jack' (PEOPLE in src/core/team.js)
  assigned_by  text not null default '',                 -- who last chose assigned_to
  seen_at      timestamptz,                              -- null = new to assigned_to
  due_on       date not null,
  done_at      timestamptz,
  done_by      text not null default '',
  activity_id  bigint unique references public.client_activity(id) on delete set null,  -- the client note it came from
  created_by   text not null default '',
  created_at   timestamptz not null default now(),
  modified_at  timestamptz not null default now()
);
create index tasks_open on public.tasks (due_on) where done_at is null;
create trigger tasks_touch before update on public.tasks
  for each row execute function public.touch_modified_at();
alter table public.tasks enable row level security;
create policy tasks_staff_all on public.tasks
  for all to authenticated using (public.is_gecko_staff()) with check (public.is_gecko_staff());

-- Follow-ups already on client notes become tasks, open and done alike: the first line of the note,
-- for whoever logged it, already seen, linked to the note. The site no longer reads or writes
-- client_activity.follow_up_on / follow_up_done_at / follow_up_done_by; the columns stay.
insert into public.tasks (title, client_name, assigned_to, assigned_by, seen_at, due_on, done_at, done_by, activity_id, created_by, created_at)
select coalesce(nullif(left(btrim(split_part(a.body, E'\n', 1)), 140), ''), 'Follow up'),
       a.client_name,
       case when a.created_by ilike 'jack%' then 'Jack' else 'Philip' end,
       case when a.created_by ilike 'jack%' then 'Jack' else 'Philip' end,
       a.created_at, a.follow_up_on, a.follow_up_done_at, a.follow_up_done_by, a.id, a.created_by, a.created_at
from public.client_activity a
where a.follow_up_on is not null
on conflict (activity_id) do nothing;
