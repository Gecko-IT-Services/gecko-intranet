-- PCs that should be on by now and aren't (Philip, 19 Oct 2026, after Kelly's PC at Daron Motors sat on a blue screen all
-- morning with nothing on the dashboard: "this dashboard should be telling me this"). A PC that can't start can't report, so
-- the only sign is silence; to tell "broken" from "switched off" Gecko HQ has to know which PCs are normally on every day.
-- Design: docs/superpowers/specs/2026-10-19-not-on-this-morning-design.md

-- One row per device per UK day it was heard from: the earliest and latest Atera "last seen" the syncs caught that day.
-- Atera keeps no history (atera_agents is replaced on every sync), so this is it. Kept 70 days.
create table public.atera_seen_days (
  agent_id      bigint not null,
  day           date not null,
  first_seen    timestamptz not null,
  last_seen     timestamptz not null,
  primary key (agent_id, day)
);
alter table public.atera_seen_days enable row level security;
create policy atera_seen_days_staff_read on public.atera_seen_days for select to authenticated using (public.is_gecko_staff());

-- Written after every good sync (the trigger below), so the Edge Function doesn't change.
create or replace function public.record_atera_seen_days() returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.atera_seen_days (agent_id, day, first_seen, last_seen)
    select agent_id, (last_seen at time zone 'Europe/London')::date, last_seen, last_seen
      from public.atera_agents
     where last_seen is not null and (last_seen at time zone 'Europe/London')::date >= (now() at time zone 'Europe/London')::date - 1
  on conflict (agent_id, day) do update
    set first_seen = least(atera_seen_days.first_seen, excluded.first_seen),
        last_seen  = greatest(atera_seen_days.last_seen, excluded.last_seen);
  delete from public.atera_seen_days where day < current_date - 70;
  return null;
end $$;
create trigger atera_status_seen_days after update on public.atera_status
  for each row when (new.last_sync_ok is true and new.last_sync_at is distinct from old.last_sync_at)
  execute function public.record_atera_seen_days();

-- "Known about": hide a device from the check until a date (someone's on holiday, a spare PC, already being fixed).
create table public.device_offline_ok (
  agent_id      bigint primary key,
  machine_name  text not null default '',
  until         date not null,
  note          text not null default '',
  updated_by    text not null default '',
  modified_at   timestamptz not null default now()
);
create trigger device_offline_ok_touch before update on public.device_offline_ok
  for each row execute function public.touch_modified_at();
alter table public.device_offline_ok enable row level security;
create policy device_offline_ok_staff_all on public.device_offline_ok
  for all to authenticated using (public.is_gecko_staff()) with check (public.is_gecko_staff());

-- Weekday mornings every half hour from 07:13 to 10:43 UTC (08:13–11:43 in summer, 07:13–10:43 in winter), on top of the
-- four daily syncs, so "not on yet" is known within half an hour of the office opening.
do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') and exists (select 1 from pg_extension where extname = 'pg_net') then
    perform cron.schedule('atera-sync-mornings', '13,43 7-10 * * 1-5', $job$
      select net.http_post(
        url := 'https://nkobrqzsogtyxriqqwnq.supabase.co/functions/v1/atera-sync',
        headers := jsonb_build_object('content-type', 'application/json',
                                      'x-cron-secret', (select secret from private.cron_secret where id = 1)),
        body := '{}'::jsonb,
        timeout_milliseconds := 60000)
    $job$);
  end if;
end $$;
