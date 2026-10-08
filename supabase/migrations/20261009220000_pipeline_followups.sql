-- Sharper pipeline (Philip, 9 Oct 2026: third of the contacts/sales improvements).
-- follow_up_on: when to chase a deal next (shown on the deal and on Overview › Today when due).
-- job_id: the Job made from a won deal's one-off part ("Both, depending on the deal": one-off → Job,
--   monthly → set up billing). jobs.source_ref = 'opp:<id>' (unique) stops a second Job for the same deal.
-- billing_set_up_at: ticked once the repeating invoice (Xero) and service line are in place for a won monthly deal.
-- Design: docs/superpowers/specs/2026-10-09-sharper-pipeline-design.md

alter table public.opportunities
  add column follow_up_on date,
  add column job_id bigint references public.jobs(id) on delete set null,
  add column billing_set_up_at timestamptz,
  add column billing_set_up_by text not null default '';
