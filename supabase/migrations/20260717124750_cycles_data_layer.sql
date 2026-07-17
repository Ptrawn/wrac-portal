-- ============================================================================
-- Migration: cycles data layer (per-cycle container)
-- One row per annual research cycle. Manager-only for now; researchers and
-- committee gain read access in later slices when they have cycle-facing UI.
-- Reuses existing functions from the profiles migration:
--   public.is_manager(uuid)  and  public.set_updated_at()
--
-- NOTE: apply by pasting into the Supabase dashboard SQL editor.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. cycles table
-- ----------------------------------------------------------------------------
create table if not exists public.cycles (
  id                     uuid primary key default gen_random_uuid(),
  name                   text not null,          -- e.g. "2026 Research Cycle"
  year                   int not null,           -- e.g. 2026
  status                 text not null default 'setup'
    check (status in (
      'setup',
      'pre_proposal_open',
      'pre_review',
      'advance_decision',
      'full_proposal_open',
      'full_review',
      'deliberation',
      'funding_decisions',
      'closed'
    )),
  total_budget           numeric(14, 2)
    check (total_budget is null or total_budget >= 0),
  pre_proposal_opens_at  date,
  pre_proposal_closes_at date,
  pre_review_due_at      date,
  full_proposal_due_at   date,
  full_review_due_at     date,
  created_at             timestamptz not null default now(),
  updated_at             timestamptz not null default now(),

  -- Date ordering, null-tolerant: each passes if either side is null so the
  -- Manager can fill the calendar in incrementally during setup.
  constraint cycles_pre_close_after_open check (
    pre_proposal_opens_at is null
    or pre_proposal_closes_at is null
    or pre_proposal_closes_at >= pre_proposal_opens_at
  ),
  constraint cycles_pre_review_after_pre_close check (
    pre_proposal_closes_at is null
    or pre_review_due_at is null
    or pre_review_due_at >= pre_proposal_closes_at
  ),
  constraint cycles_full_due_after_pre_close check (
    pre_proposal_closes_at is null
    or full_proposal_due_at is null
    or full_proposal_due_at >= pre_proposal_closes_at
  ),
  constraint cycles_full_review_after_full_due check (
    full_proposal_due_at is null
    or full_review_due_at is null
    or full_review_due_at >= full_proposal_due_at
  )
);

-- ----------------------------------------------------------------------------
-- 2. keep updated_at current (reuses existing public.set_updated_at())
-- ----------------------------------------------------------------------------
drop trigger if exists trg_cycles_set_updated_at on public.cycles;
create trigger trg_cycles_set_updated_at
  before update on public.cycles
  for each row
  execute function public.set_updated_at();

-- ----------------------------------------------------------------------------
-- 3. Row Level Security -- manager-only (deny by default for everyone else)
-- ----------------------------------------------------------------------------
grant select, insert, update, delete on public.cycles to authenticated;

alter table public.cycles enable row level security;

drop policy if exists "cycles_select_manager" on public.cycles;
drop policy if exists "cycles_insert_manager" on public.cycles;
drop policy if exists "cycles_update_manager" on public.cycles;
drop policy if exists "cycles_delete_manager" on public.cycles;

create policy "cycles_select_manager"
  on public.cycles
  for select
  to authenticated
  using (public.is_manager(auth.uid()));

create policy "cycles_insert_manager"
  on public.cycles
  for insert
  to authenticated
  with check (public.is_manager(auth.uid()));

create policy "cycles_update_manager"
  on public.cycles
  for update
  to authenticated
  using (public.is_manager(auth.uid()))
  with check (public.is_manager(auth.uid()));

create policy "cycles_delete_manager"
  on public.cycles
  for delete
  to authenticated
  using (public.is_manager(auth.uid()));
