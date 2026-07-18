-- ============================================================================
-- Migration: document_requirements data layer
-- Each row is one required/optional upload slot for a cycle + stage.
-- Manager-only for now; researchers gain scoped read access in the
-- proposal-submission slice.
-- Reuses existing functions from the profiles migration:
--   public.is_manager(uuid)  and  public.set_updated_at()
--
-- NOTE: apply by pasting into the Supabase dashboard SQL editor.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. document_requirements table
-- ----------------------------------------------------------------------------
create table if not exists public.document_requirements (
  id                  uuid primary key default gen_random_uuid(),
  cycle_id            uuid not null references public.cycles (id) on delete cascade,
  stage               text not null
                        check (stage in ('pre', 'full', 'status_report', 'final_report')),
  label               text not null,                        -- e.g. "Proposal narrative"
  description         text,                                 -- optional instructions to the researcher
  is_required         boolean not null default true,
  accepted_file_types text not null default 'pdf',          -- comma-separated extensions, e.g. 'pdf' or 'pdf,docx'
  sort_order          int not null default 0,
  is_active           boolean not null default true,        -- soft-delete: deactivate, never hard-delete once a submission references it
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);

-- Fetch a stage's slot set for a cycle.
create index if not exists document_requirements_cycle_stage_idx
  on public.document_requirements (cycle_id, stage);

-- ----------------------------------------------------------------------------
-- 2. keep updated_at current (reuses existing public.set_updated_at())
-- ----------------------------------------------------------------------------
drop trigger if exists trg_document_requirements_set_updated_at on public.document_requirements;
create trigger trg_document_requirements_set_updated_at
  before update on public.document_requirements
  for each row
  execute function public.set_updated_at();

-- ----------------------------------------------------------------------------
-- 3. Row Level Security -- manager-only (deny by default for everyone else)
-- ----------------------------------------------------------------------------
grant select, insert, update, delete on public.document_requirements to authenticated;

alter table public.document_requirements enable row level security;

drop policy if exists "document_requirements_select_manager" on public.document_requirements;
drop policy if exists "document_requirements_insert_manager" on public.document_requirements;
drop policy if exists "document_requirements_update_manager" on public.document_requirements;
drop policy if exists "document_requirements_delete_manager" on public.document_requirements;

create policy "document_requirements_select_manager"
  on public.document_requirements
  for select
  to authenticated
  using (public.is_manager(auth.uid()));

create policy "document_requirements_insert_manager"
  on public.document_requirements
  for insert
  to authenticated
  with check (public.is_manager(auth.uid()));

create policy "document_requirements_update_manager"
  on public.document_requirements
  for update
  to authenticated
  using (public.is_manager(auth.uid()))
  with check (public.is_manager(auth.uid()));

create policy "document_requirements_delete_manager"
  on public.document_requirements
  for delete
  to authenticated
  using (public.is_manager(auth.uid()));
