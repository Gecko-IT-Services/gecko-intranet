-- Staff access needs a Microsoft (Gecko tenant) sign-in, not just a matching email claim
-- (code review, 9 Oct 2026). The site only ever signs in with signInWithIdToken({ provider: 'azure' }),
-- so every real staff session has an azure identity. A session from any other provider (email sign-up,
-- phone, anonymous) that happens to carry a staff address no longer passes.
-- create or replace keeps the existing grants (execute to authenticated only).

create or replace function public.is_gecko_staff() returns boolean
  language sql stable security definer set search_path = ''
as $$
  select exists (
    select 1 from public.staff
    where email = lower(coalesce(auth.jwt() ->> 'email', ''))
  ) and exists (
    select 1 from auth.identities
    where user_id = auth.uid() and provider = 'azure'
  );
$$;
