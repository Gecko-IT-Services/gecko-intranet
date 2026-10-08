-- Invoice a job in Xero from the Jobs page (Philip, 8 Oct 2026). The xero-invoice Edge Function
-- creates a DRAFT sales invoice in Xero; Philip checks, approves and sends it in Xero.
-- Every attempt is recorded here: the request key makes a double click or a retry create one
-- invoice, not two (it is also sent to Xero as its Idempotency-Key), and it is the audit trail
-- of who invoiced what. Only the function writes; staff can read.
-- Design: docs/superpowers/specs/2026-10-08-xero-integration-design.md (phase 3)

create table public.xero_pushes (
  id              bigint generated always as identity primary key,
  request_key     text not null unique,                 -- one per "Create draft" form
  job_id          bigint references public.jobs (id) on delete set null,
  contact_id      text not null,
  contact_name    text not null default '',
  item_code       text not null default '',
  account_code    text not null default '',
  description     text not null default '',
  amount          numeric not null check (amount > 0),  -- £ net
  state           text not null default 'pending' check (state in ('pending','done','failed')),
  invoice_id      text,
  invoice_number  text,
  error           text not null default '',
  created_by      text not null default '',
  created_at      timestamptz not null default now(),
  done_at         timestamptz
);
create index xero_pushes_job on public.xero_pushes (job_id);

alter table public.xero_pushes enable row level security;
create policy xero_pushes_staff_read on public.xero_pushes
  for select to authenticated using (public.is_gecko_staff());
