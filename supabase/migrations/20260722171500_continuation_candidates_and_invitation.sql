-- ============================================================================
-- Migration: continuation candidate + invitation RPCs (manager-only), a
-- plan-context reader for review/comparison, AND a project-lifecycle fix so a
-- funded project is promoted to 'active'.
--
-- Multi-year projects require a fresh proposal each year, funded from that
-- year's pool. Continuations are MANAGER-INVITED (like full proposals) and
-- submitted during full_proposal_open against the full-proposal deadline
-- (already enforced by submit_proposal). A continuation crosses cycles: working
-- in a NEW cycle, the manager invites year N+1 of a project whose year N was
-- funded in a PRIOR cycle. The originating funded proposal is linked via
-- parent_proposal_id for committee context and plan comparison.
--
-- Reuses existing functions: public.is_manager(uuid), public.is_committee(uuid),
--   public.proposal_visible_to_committee(uuid). Does NOT redefine them.
--
-- PROJECT-STATUS FIX: previously nothing promoted a project to 'active' when a
-- proposal was funded (only end_project wrote status, setting 'ended'; projects
-- default to 'proposed'), leaving projects permanently 'proposed'. The
-- researcher dashboard and reports lifecycle (active -> completed when a final
-- report lands) need this distinction, so set_funding_decision now promotes the
-- project to 'active' on a funding award -- only from 'proposed', never
-- downgrading a closed ('completed'/'ended'/'declined') project. Existing funded
-- projects predate this fix and remain 'proposed', so continuation eligibility
-- accepts status IN ('proposed','active').
--
-- NOTE: apply by pasting into the Supabase dashboard SQL editor.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. set_funding_decision(p_id, p_funded, p_amount) -- RESTATED
--    Records a funding decision (unchanged behaviour) AND, on a funding award,
--    promotes the proposal's project 'proposed' -> 'active'. The projects guard
--    (enforce_project_owner_rules) blocks non-admin/non-manager status changes,
--    so the project write is wrapped in the app.project_rpc bypass flag exactly
--    as end_project does. Managers pass the guard anyway; the flag makes the
--    sanctioned write explicit and safe.
-- ----------------------------------------------------------------------------
create or replace function public.set_funding_decision(
  p_id uuid,
  p_funded boolean,
  p_amount numeric
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_type    text;
  v_state   text;
  v_project uuid;
begin
  if not public.is_manager(auth.uid()) then
    raise exception 'Only a manager may record a funding decision'
      using errcode = '42501';
  end if;

  select type, state, project_id into v_type, v_state, v_project
  from public.proposals
  where id = p_id
  for update;

  if v_type is null then
    raise exception 'Proposal not found' using errcode = 'P0002';
  end if;
  if v_state <> 'submitted' then
    raise exception 'Only a submitted proposal can receive a funding decision'
      using errcode = '42501';
  end if;
  if v_type not in ('full', 'continuation', 'off_cycle') then
    raise exception 'Pre-proposals do not receive funding decisions'
      using errcode = '42501';
  end if;

  -- No budget cap here: the Manager may deliberately over/under-allocate during
  -- discussion; the UI shows remaining and can warn. Re-deciding is allowed.
  perform set_config('app.proposal_rpc', 'on', true);
  if p_funded then
    if p_amount is null or p_amount < 0 then
      raise exception 'A funded amount must be provided and be zero or greater'
        using errcode = '22023';  -- invalid_parameter_value
    end if;
    update public.proposals
    set outcome = 'funded', funded_amount = p_amount
    where id = p_id;
  else
    update public.proposals
    set outcome = 'not_funded', funded_amount = null
    where id = p_id;
  end if;
  perform set_config('app.proposal_rpc', 'off', true);

  -- Promote the project to 'active' on a funding award. Only from 'proposed'
  -- (never downgrade a completed/ended/declined project). Guard bypass mirrors
  -- end_project so the sanctioned status write passes enforce_project_owner_rules.
  if p_funded then
    perform set_config('app.project_rpc', 'on', true);
    update public.projects
    set status = 'active'
    where id = v_project
      and status = 'proposed';
    perform set_config('app.project_rpc', 'off', true);
  end if;
end;
$$;

revoke all on function public.set_funding_decision(uuid, boolean, numeric) from public, anon;
grant execute on function public.set_funding_decision(uuid, boolean, numeric) to authenticated;

-- ----------------------------------------------------------------------------
-- 2. list_continuation_candidates(p_cycle_id) -- projects eligible to continue
-- ----------------------------------------------------------------------------
create or replace function public.list_continuation_candidates(p_cycle_id uuid)
returns table (
  project_id             uuid,
  project_title          text,
  planned_years          int,
  researcher_id          uuid,
  researcher_name        text,
  researcher_institution text,
  last_funded_proposal_id uuid,
  last_funded_year       int,
  last_funded_amount     numeric,
  last_funded_cycle_name text,
  next_year_number       int,
  projected_amount       numeric
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not public.is_manager(auth.uid()) then
    raise exception 'Only a manager may list continuation candidates'
      using errcode = '42501';
  end if;

  return query
  with funded as (
    -- Every funded proposal in a cycle OTHER than the target cycle, with the
    -- highest-year one flagged (rn = 1) and the project's max funded year.
    select
      p.project_id,
      p.id            as proposal_id,
      p.year_number,
      p.funded_amount,
      p.cycle_id,
      max(p.year_number) over (partition by p.project_id) as max_funded_year,
      row_number() over (
        partition by p.project_id
        order by p.year_number desc, p.submitted_at desc nulls last, p.created_at desc
      ) as rn
    from public.proposals p
    where p.outcome = 'funded'          -- only funded proposals establish a lineage
      and p.cycle_id <> p_cycle_id      -- continuation crosses cycles
  )
  select
    pr.id                       as project_id,
    pr.title                    as project_title,
    pr.planned_years,
    pr.researcher_id,
    prof.full_name              as researcher_name,
    prof.institution            as researcher_institution,
    f.proposal_id               as last_funded_proposal_id,
    f.year_number               as last_funded_year,
    f.funded_amount             as last_funded_amount,
    lc.name                     as last_funded_cycle_name,
    (f.year_number + 1)         as next_year_number,
    by.planned_amount           as projected_amount
  from public.projects pr
  join public.profiles prof on prof.id = pr.researcher_id
  join funded f              on f.project_id = pr.id and f.rn = 1
  join public.cycles lc      on lc.id = f.cycle_id
  -- What they originally projected for the upcoming year, from the last funded
  -- proposal's own multi-year plan (null if that plan has no row for the year).
  left join public.proposal_budget_years by
    on by.proposal_id = f.proposal_id
   and by.year_number = f.year_number + 1
  where pr.status in ('proposed', 'active')      -- excludes completed/ended/declined
    and pr.planned_years > f.max_funded_year      -- years remain to continue
    and not exists (                              -- no duplicate invitation
      select 1 from public.proposals x
      where x.project_id = pr.id
        and x.cycle_id = p_cycle_id
    )
  order by prof.full_name, pr.title;
end;
$$;

revoke all on function public.list_continuation_candidates(uuid) from public, anon;
grant execute on function public.list_continuation_candidates(uuid) to authenticated;

-- ----------------------------------------------------------------------------
-- 3. invite_continuation(p_project_id, p_cycle_id) -- create the draft
-- ----------------------------------------------------------------------------
create or replace function public.invite_continuation(p_project_id uuid, p_cycle_id uuid)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_status          text;
  v_researcher      uuid;
  v_title           text;
  v_planned_years   int;
  v_last_id         uuid;
  v_last_year       int;
  v_max_funded_year int;
  v_projected       numeric;
  v_new_id          uuid;
begin
  if not public.is_manager(auth.uid()) then
    raise exception 'Only a manager may invite a continuation'
      using errcode = '42501';
  end if;

  select pr.status, pr.researcher_id, pr.title, pr.planned_years
    into v_status, v_researcher, v_title, v_planned_years
  from public.projects pr
  where pr.id = p_project_id
  for update;

  if v_status is null then
    raise exception 'Project not found' using errcode = 'P0002';
  end if;
  if v_status not in ('proposed', 'active') then
    raise exception 'This project is % and cannot be continued', v_status
      using errcode = '42501';
  end if;

  -- Don't offer a duplicate invitation: the project must not already have a
  -- proposal in this cycle.
  if exists (
    select 1 from public.proposals x
    where x.project_id = p_project_id
      and x.cycle_id = p_cycle_id
  ) then
    raise exception 'This project already has a proposal in this cycle'
      using errcode = '42501';
  end if;

  -- Most recent funded proposal in a prior cycle (highest funded year).
  select f.proposal_id, f.year_number, f.max_funded_year
    into v_last_id, v_last_year, v_max_funded_year
  from (
    select
      p.id            as proposal_id,
      p.year_number,
      max(p.year_number) over () as max_funded_year,
      row_number() over (
        order by p.year_number desc, p.submitted_at desc nulls last, p.created_at desc
      ) as rn
    from public.proposals p
    where p.project_id = p_project_id
      and p.outcome = 'funded'
      and p.cycle_id <> p_cycle_id
  ) f
  where f.rn = 1;

  if v_last_id is null then
    raise exception 'This project has no funded proposal in a prior cycle to continue from'
      using errcode = '42501';
  end if;
  if v_planned_years <= v_max_funded_year then
    raise exception 'This project has no remaining planned years to continue'
      using errcode = '42501';
  end if;

  -- Projected amount for the upcoming year, from the last funded proposal's
  -- original multi-year plan (null if that plan has no row for the year). This
  -- is a starting point the researcher can revise on their draft.
  select by.planned_amount into v_projected
  from public.proposal_budget_years by
  where by.proposal_id = v_last_id
    and by.year_number = v_last_year + 1;

  perform set_config('app.proposal_rpc', 'on', true);
  insert into public.proposals (
    project_id, cycle_id, researcher_id, type, parent_proposal_id,
    title, year_number, requested_amount, state
  )
  values (
    p_project_id, p_cycle_id, v_researcher, 'continuation', v_last_id,
    v_title, v_last_year + 1, v_projected, 'draft'
  )
  returning id into v_new_id;
  perform set_config('app.proposal_rpc', 'off', true);

  return v_new_id;
end;
$$;

revoke all on function public.invite_continuation(uuid, uuid) from public, anon;
grant execute on function public.invite_continuation(uuid, uuid) to authenticated;

-- ----------------------------------------------------------------------------
-- 4. proposal_plan_context(p_id) -- the ORIGINAL multi-year plan for comparison
--    Access: the proposal's owner, a committee member who can see it, or a
--    manager (checked in that order). For a continuation, returns the original
--    plan from the project's lineage (the full proposal that carries the plan)
--    so the UI can show "originally projected $X for year N" next to the ask.
--    No parent -> zero rows (nothing to compare against).
-- ----------------------------------------------------------------------------
create or replace function public.proposal_plan_context(p_id uuid)
returns table (
  year_number       int,
  planned_amount    numeric,
  source_proposal_id uuid,
  source_cycle_name text
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_owner   uuid;
  v_project uuid;
  v_parent  uuid;
  v_source  uuid;
begin
  select p.researcher_id, p.project_id, p.parent_proposal_id
    into v_owner, v_project, v_parent
  from public.proposals p
  where p.id = p_id;

  if v_owner is null then
    raise exception 'Proposal not found' using errcode = 'P0002';
  end if;

  -- Access check in the required order: owner, then committee-who-can-see,
  -- then manager.
  if not (
    v_owner = auth.uid()
    or (public.is_committee(auth.uid()) and public.proposal_visible_to_committee(p_id))
    or public.is_manager(auth.uid())
  ) then
    raise exception 'You do not have access to this proposal'
      using errcode = '42501';
  end if;

  -- No parent: no original projection to show.
  if v_parent is null then
    return;
  end if;

  -- Plan source: the proposal in this project's lineage that carries the
  -- multi-year plan (in practice the year-1 full proposal; continuations don't
  -- re-enter a plan). Take the earliest such proposal.
  select p.id into v_source
  from public.proposals p
  where p.project_id = v_project
    and exists (
      select 1 from public.proposal_budget_years by
      where by.proposal_id = p.id
    )
  order by p.year_number, p.created_at
  limit 1;

  if v_source is null then
    return;  -- no plan rows anywhere in the lineage
  end if;

  return query
  select
    by.year_number,
    by.planned_amount,
    p.id     as source_proposal_id,
    c.name   as source_cycle_name
  from public.proposal_budget_years by
  join public.proposals p on p.id = by.proposal_id
  join public.cycles c    on c.id = p.cycle_id
  where by.proposal_id = v_source
  order by by.year_number;
end;
$$;

revoke all on function public.proposal_plan_context(uuid) from public, anon;
grant execute on function public.proposal_plan_context(uuid) to authenticated;
