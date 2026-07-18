-- ============================================================================
-- Migration: grant approved researchers scoped READ access to cycle config
-- cycles, review_questions, document_requirements are currently manager-only
-- SELECT. Approved researchers need to see open cycles and their document
-- requirements to submit proposals. review_questions stays manager-only
-- (committee read access comes in the review slice).
--
-- Reuses existing functions: public.is_manager(uuid),
--   public.is_approved_researcher(uuid). Adds: public.cycle_is_visible(uuid).
--
-- NOTE: apply by pasting into the Supabase dashboard SQL editor.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. Helper: cycle_is_visible(c_id)
--    SECURITY DEFINER so document_requirements policies can consult cycle
--    status without RLS recursion. True when the cycle is out of 'setup'.
-- ----------------------------------------------------------------------------
create or replace function public.cycle_is_visible(c_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.cycles
    where id = c_id
      and status <> 'setup'
  );
$$;

-- ----------------------------------------------------------------------------
-- 2. cycles -- approved researchers may read cycles not in 'setup'.
--    Existing manager policies are left untouched.
-- ----------------------------------------------------------------------------
drop policy if exists "cycles_select_approved_researcher" on public.cycles;

create policy "cycles_select_approved_researcher"
  on public.cycles for select to authenticated
  using (
    public.is_approved_researcher(auth.uid())
    and status <> 'setup'
  );

-- ----------------------------------------------------------------------------
-- 3. document_requirements -- approved researchers may read ACTIVE
--    requirements of a visible (non-setup) cycle. Manager policies untouched.
-- ----------------------------------------------------------------------------
drop policy if exists "document_requirements_select_approved_researcher" on public.document_requirements;

create policy "document_requirements_select_approved_researcher"
  on public.document_requirements for select to authenticated
  using (
    public.is_approved_researcher(auth.uid())
    and is_active = true
    and public.cycle_is_visible(cycle_id)
  );

-- ----------------------------------------------------------------------------
-- 4. review_questions -- intentionally NOT granted to researchers here.
--    Left manager-only; committee read access arrives in the review slice.
-- ----------------------------------------------------------------------------
