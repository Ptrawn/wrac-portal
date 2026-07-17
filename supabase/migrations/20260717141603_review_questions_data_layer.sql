-- ============================================================================
-- Migration: review_questions data layer
-- Each row is one review question belonging to a cycle + stage (pre / full).
-- Manager-only for now; committee gains scoped read access in the review slice.
-- Reuses existing functions from the profiles migration:
--   public.is_manager(uuid)  and  public.set_updated_at()
--
-- NOTE: apply by pasting into the Supabase dashboard SQL editor.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. review_questions table
-- ----------------------------------------------------------------------------
create table if not exists public.review_questions (
  id          uuid primary key default gen_random_uuid(),
  cycle_id    uuid not null references public.cycles (id) on delete cascade,
  stage       text not null check (stage in ('pre', 'full')),  -- pre- vs full-proposal review
  prompt      text not null,                                    -- the question text
  score_min   int not null default 0,
  score_max   int not null default 10,
  sort_order  int not null default 0,                           -- Manager-arranged display order
  is_active   boolean not null default true,                    -- soft-delete: deactivate, never hard-delete once reviews reference it
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),

  constraint review_questions_score_range check (score_max > score_min)
);

-- Fetch a full question set for a cycle + stage.
create index if not exists review_questions_cycle_stage_idx
  on public.review_questions (cycle_id, stage);

-- ----------------------------------------------------------------------------
-- 2. keep updated_at current (reuses existing public.set_updated_at())
-- ----------------------------------------------------------------------------
drop trigger if exists trg_review_questions_set_updated_at on public.review_questions;
create trigger trg_review_questions_set_updated_at
  before update on public.review_questions
  for each row
  execute function public.set_updated_at();

-- ----------------------------------------------------------------------------
-- 3. Row Level Security -- manager-only (deny by default for everyone else)
-- ----------------------------------------------------------------------------
grant select, insert, update, delete on public.review_questions to authenticated;

alter table public.review_questions enable row level security;

drop policy if exists "review_questions_select_manager" on public.review_questions;
drop policy if exists "review_questions_insert_manager" on public.review_questions;
drop policy if exists "review_questions_update_manager" on public.review_questions;
drop policy if exists "review_questions_delete_manager" on public.review_questions;

create policy "review_questions_select_manager"
  on public.review_questions
  for select
  to authenticated
  using (public.is_manager(auth.uid()));

create policy "review_questions_insert_manager"
  on public.review_questions
  for insert
  to authenticated
  with check (public.is_manager(auth.uid()));

create policy "review_questions_update_manager"
  on public.review_questions
  for update
  to authenticated
  using (public.is_manager(auth.uid()))
  with check (public.is_manager(auth.uid()));

create policy "review_questions_delete_manager"
  on public.review_questions
  for delete
  to authenticated
  using (public.is_manager(auth.uid()));
