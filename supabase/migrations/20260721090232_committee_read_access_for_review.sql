-- ============================================================================
-- Migration: committee members' scoped READ access for review
-- A committee member may read a proposal when state='submitted' AND its cycle
-- is not in 'setup'. Drafts / reopened / rescinded proposals are NOT visible
-- (a reopened proposal is being edited, so it correctly drops out of view).
-- Reviews are siloed -- this grants NO access to other members' reviews.
--
-- Reuses existing functions: public.is_committee(uuid), public.is_manager(uuid),
--   public.cycle_is_visible(uuid). Adds four committee-visibility helpers.
--
-- NOTE: apply by pasting into the Supabase dashboard SQL editor.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. Visibility helpers (SECURITY DEFINER so policies avoid RLS recursion)
-- ----------------------------------------------------------------------------

-- A proposal is visible when it's submitted and its cycle is out of setup.
create or replace function public.proposal_visible_to_committee(p_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.proposals p
    where p.id = p_id
      and p.state = 'submitted'
      and public.cycle_is_visible(p.cycle_id)
  );
$$;

-- A project is visible when it has at least one committee-visible proposal.
create or replace function public.project_visible_to_committee(pr_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.proposals p
    where p.project_id = pr_id
      and p.state = 'submitted'
      and public.cycle_is_visible(p.cycle_id)
  );
$$;

-- A researcher is visible when they own at least one committee-visible proposal.
create or replace function public.researcher_visible_to_committee(uid uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.proposals p
    where p.researcher_id = uid
      and p.state = 'submitted'
      and public.cycle_is_visible(p.cycle_id)
  );
$$;

-- ----------------------------------------------------------------------------
-- 2. proposals -- committee reads submitted proposals in visible cycles
-- ----------------------------------------------------------------------------
drop policy if exists "proposals_select_committee" on public.proposals;
create policy "proposals_select_committee"
  on public.proposals for select to authenticated
  using (
    public.is_committee(auth.uid())
    and state = 'submitted'
    and public.cycle_is_visible(cycle_id)
  );

-- ----------------------------------------------------------------------------
-- 3. review_questions -- committee reads the active question set to answer it
-- ----------------------------------------------------------------------------
drop policy if exists "review_questions_select_committee" on public.review_questions;
create policy "review_questions_select_committee"
  on public.review_questions for select to authenticated
  using (
    public.is_committee(auth.uid())
    and is_active = true
    and public.cycle_is_visible(cycle_id)
  );

-- ----------------------------------------------------------------------------
-- 4. proposal_documents -- committee reads docs of visible proposals
-- ----------------------------------------------------------------------------
drop policy if exists "proposal_docs_select_committee" on public.proposal_documents;
create policy "proposal_docs_select_committee"
  on public.proposal_documents for select to authenticated
  using (
    public.is_committee(auth.uid())
    and public.proposal_visible_to_committee(proposal_id)
  );

-- ----------------------------------------------------------------------------
-- 5. proposal_budget_years -- committee reads plan of visible proposals
-- ----------------------------------------------------------------------------
drop policy if exists "budget_years_select_committee" on public.proposal_budget_years;
create policy "budget_years_select_committee"
  on public.proposal_budget_years for select to authenticated
  using (
    public.is_committee(auth.uid())
    and public.proposal_visible_to_committee(proposal_id)
  );

-- ----------------------------------------------------------------------------
-- 6. projects -- committee reads projects that have a visible proposal
-- ----------------------------------------------------------------------------
drop policy if exists "projects_select_committee" on public.projects;
create policy "projects_select_committee"
  on public.projects for select to authenticated
  using (
    public.is_committee(auth.uid())
    and public.project_visible_to_committee(id)
  );

-- ----------------------------------------------------------------------------
-- 7. profiles -- committee sees researchers who submitted a visible proposal
--    (review is not blind). No pending/rejected researchers without a visible
--    proposal are exposed.
-- ----------------------------------------------------------------------------
drop policy if exists "profiles_select_committee_researcher" on public.profiles;
create policy "profiles_select_committee_researcher"
  on public.profiles for select to authenticated
  using (
    public.is_committee(auth.uid())
    and public.researcher_visible_to_committee(id)
  );

-- ----------------------------------------------------------------------------
-- 8. Storage -- committee reads files of visible proposals (SELECT only).
--    Same uuid-regex CASE guard as the other proposals-bucket policies so a
--    malformed first path segment can't raise a cast error.
-- ----------------------------------------------------------------------------
drop policy if exists "proposals_bucket_select_committee" on storage.objects;
create policy "proposals_bucket_select_committee"
  on storage.objects for select to authenticated
  using (
    bucket_id = 'proposals'
    and public.is_committee(auth.uid())
    and public.proposal_visible_to_committee(
      case
        when (storage.foldername(name))[1] ~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'
        then ((storage.foldername(name))[1])::uuid
      end
    )
  );
