-- ============================================================================
-- Migration: withdraw an invitation issued in error (manager)
--
-- A manager can invite a full proposal or a continuation by mistake -- wrong
-- pre-proposal, wrong project, wrong cycle. Until now there was NO way back:
-- the child draft sat on the researcher's dashboard forever, and because both
-- invite RPCs refuse to create a second child, the correct invitation could
-- never be issued.
--
-- withdraw_invitation marks the child draft 'withdrawn'. It is never deleted --
-- consistent with the rest of this schema, which has no delete policy on
-- proposals and preserves history through state instead ('rescinded' when the
-- researcher pulls a proposal; 'withdrawn' when the manager un-issues an
-- invitation). The two are deliberately distinct: they are different stories
-- and the researcher-facing copy differs.
--
-- WORK-STARTED GATE. Withdrawal is refused once the researcher has begun. The
-- gate is: submitted_at is null, zero proposal_budget_years rows, zero
-- proposal_documents rows. Immediately after an invitation all three hold --
-- neither invite RPC creates budget-year or document rows, and neither sets
-- submitted_at. title and requested_amount are deliberately NOT checked: both
-- are COPIED FROM THE PARENT at invitation, so they are already populated on a
-- completely untouched draft and cannot distinguish work from no work.
--
-- 'withdrawn' is a new state value, not a boolean flag, because every consumer
-- already branches on state -- which means the new value inherits the right
-- behaviour everywhere for free:
--   * the proposal owner-guard locks the row (old.state not in draft/reopened),
--     so the researcher can no longer edit it;
--   * committee RLS requires state = 'submitted', so it is invisible to
--     reviewers;
--   * submit_proposal / rescind_proposal / reopen_proposal / unrescind_proposal
--     all reject it on their existing state preconditions (verified by
--     inspection; none of the four is modified here).
--
-- Four call sites must learn to ignore withdrawn children, or withdrawal is
-- pointless -- the re-invitation would still be blocked. They are restated in
-- full below (items 4-7). NOTE especially list_continuation_candidates: without
-- its exclusion the project never reappears as a candidate, so the manager has
-- no button to press even though invite_continuation would now allow it.
--
-- DELIBERATELY NOT ADDED: any unique index on parent_proposal_id. A withdrawn
-- child and its live replacement must be able to share a parent.
--
-- NO BACKFILL. No existing row is changed by this migration.
--
-- Reuses existing functions: public.is_manager(uuid). Does NOT redefine them.
--
-- NOTE: apply by pasting into the Supabase dashboard SQL editor.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. proposals.state -- add 'withdrawn' to the permitted values.
--
--    The original constraint was declared INLINE and UNNAMED on the column
--    (20260718093841), so Postgres auto-named it -- conventionally
--    'proposals_state_check'. Rather than trust that name, the DO block looks
--    the constraint up in pg_constraint by the column it governs and drops it
--    by its real name, then adds it back under an explicit name. That is both
--    correct if the auto-name differs and safe to re-run.
-- ----------------------------------------------------------------------------
do $$
declare
  v_conname text;
begin
  select c.conname
    into v_conname
  from pg_constraint c
  join pg_attribute a
    on a.attrelid = c.conrelid
   and a.attnum = any (c.conkey)
  where c.conrelid = 'public.proposals'::regclass
    and c.contype = 'c'                     -- CHECK
    and a.attname = 'state'
    and array_length(c.conkey, 1) = 1       -- single-column check only
  limit 1;

  if v_conname is not null then
    execute format('alter table public.proposals drop constraint %I', v_conname);
  end if;

  alter table public.proposals
    add constraint proposals_state_check
      check (state in ('draft', 'submitted', 'reopened', 'rescinded', 'withdrawn'));
end
$$;

-- ----------------------------------------------------------------------------
-- 2. proposals.withdrawn_at -- mirrors the existing rescinded_at.
-- ----------------------------------------------------------------------------
alter table public.proposals
  add column if not exists withdrawn_at timestamptz;

comment on column public.proposals.withdrawn_at is
  'When a manager withdrew this invited draft (state = ''withdrawn''). Mirrors '
  'rescinded_at. Set only via withdraw_invitation. A withdrawn proposal is an '
  'invitation the manager issued in error and un-issued before the researcher '
  'started work -- distinct from ''rescinded'', which is the researcher pulling '
  'their own proposal.';

-- ----------------------------------------------------------------------------
-- 3. withdraw_invitation(p_id) -- manager un-issues an invitation.
--    Structure follows unrescind_proposal / unend_project exactly.
-- ----------------------------------------------------------------------------
create or replace function public.withdraw_invitation(p_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_type         text;
  v_state        text;
  v_parent       uuid;
  v_submitted_at timestamptz;
  v_budget_years int;
  v_documents    int;
begin
  if not public.is_manager(auth.uid()) then
    raise exception 'Only a manager may withdraw an invitation'
      using errcode = '42501';
  end if;

  select type, state, parent_proposal_id, submitted_at
    into v_type, v_state, v_parent, v_submitted_at
  from public.proposals
  where id = p_id
  for update;

  if v_type is null then
    raise exception 'Proposal not found' using errcode = 'P0002';
  end if;

  -- (a) Only an invited proposal can be un-invited. A pre-proposal is started
  --     by the researcher, never invited, so there is nothing to withdraw.
  if v_type not in ('full', 'continuation') then
    raise exception
      'Only a full proposal or continuation can be withdrawn (this one is a %).', v_type
      using errcode = '42501';
  end if;

  -- (b) Belt and braces on the same idea: an invited proposal always carries
  --     the row it was invited from.
  if v_parent is null then
    raise exception
      'This proposal has no parent, so it was not created by an invitation and cannot be withdrawn'
      using errcode = '42501';
  end if;

  -- (c) Still an untouched draft -- not submitted, reopened, rescinded, or
  --     already withdrawn.
  if v_state <> 'draft' then
    raise exception
      'Only a draft invitation can be withdrawn (this one is %).', v_state
      using errcode = '42501';
  end if;

  -- (d)-(f) THE WORK-STARTED GATE. Any one of these means the researcher has
  --     begun; withdrawing would destroy their work. Deliberately NOT checked:
  --     title and requested_amount, which are copied from the parent at
  --     invitation and so are populated even on an untouched draft.
  if v_submitted_at is not null then
    raise exception
      'The researcher has already begun work on this draft (it was submitted on %), so the invitation can no longer be withdrawn. Rescind or reopen it instead.',
      to_char(v_submitted_at, 'FMDD FMMonth YYYY')
      using errcode = '42501';
  end if;

  select count(*) into v_budget_years
  from public.proposal_budget_years by
  where by.proposal_id = p_id;

  if v_budget_years > 0 then
    raise exception
      'The researcher has already begun work on this draft (a multi-year budget plan has been entered), so the invitation can no longer be withdrawn.'
      using errcode = '42501';
  end if;

  select count(*) into v_documents
  from public.proposal_documents d
  where d.proposal_id = p_id;

  if v_documents > 0 then
    raise exception
      'The researcher has already begun work on this draft (% document(s) uploaded), so the invitation can no longer be withdrawn.',
      v_documents
      using errcode = '42501';
  end if;

  -- The parent row is deliberately untouched: the pre-proposal is still
  -- advanced, the prior year is still funded. Only the invitation is undone.
  perform set_config('app.proposal_rpc', 'on', true);
  update public.proposals
  set state = 'withdrawn',
      withdrawn_at = now()
  where id = p_id;
  perform set_config('app.proposal_rpc', 'off', true);
end;
$$;

revoke all on function public.withdraw_invitation(uuid) from public, anon;
grant execute on function public.withdraw_invitation(uuid) to authenticated;

-- ----------------------------------------------------------------------------
-- 4. invite_full_proposal(p_pre_proposal_id) -- RESTATED IN FULL.
--    Unchanged except the one-child idempotency check, which now ignores a
--    withdrawn child so a corrected invitation can be issued.
-- ----------------------------------------------------------------------------
create or replace function public.invite_full_proposal(p_pre_proposal_id uuid)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_project    uuid;
  v_cycle      uuid;
  v_researcher uuid;
  v_title      text;
  v_type       text;
  v_state      text;
  v_outcome    text;
  v_year       int;
  v_amount     numeric;
  v_new_id     uuid;
begin
  if not public.is_manager(auth.uid()) then
    raise exception 'Only a manager may invite a full proposal'
      using errcode = '42501';
  end if;

  select project_id, cycle_id, researcher_id, title, type, state, outcome,
         year_number, requested_amount
    into v_project, v_cycle, v_researcher, v_title, v_type, v_state, v_outcome,
         v_year, v_amount
  from public.proposals
  where id = p_pre_proposal_id
  for update;

  if v_project is null then
    raise exception 'Pre-proposal not found' using errcode = 'P0002';
  end if;
  if v_type <> 'pre'
     or v_state <> 'submitted'
     or v_outcome is distinct from 'advanced' then
    raise exception
      'A full proposal can only be created from an advanced, submitted pre-proposal'
      using errcode = '42501';
  end if;

  -- Idempotency: the manager may click twice. A WITHDRAWN child does not count
  -- -- that invitation was un-issued, so a replacement is allowed.
  if exists (
    select 1 from public.proposals
    where parent_proposal_id = p_pre_proposal_id
      and state <> 'withdrawn'
  ) then
    raise exception 'A full proposal has already been created for this pre-proposal'
      using errcode = '42501';
  end if;

  perform set_config('app.proposal_rpc', 'on', true);
  insert into public.proposals (
    project_id, cycle_id, researcher_id, type, parent_proposal_id,
    title, year_number, requested_amount, state
  )
  values (
    v_project, v_cycle, v_researcher, 'full', p_pre_proposal_id,
    v_title, v_year, v_amount, 'draft'
  )
  returning id into v_new_id;
  perform set_config('app.proposal_rpc', 'off', true);

  return v_new_id;
end;
$$;

revoke all on function public.invite_full_proposal(uuid) from public, anon;
grant execute on function public.invite_full_proposal(uuid) to authenticated;

-- ----------------------------------------------------------------------------
-- 5. list_cycle_proposals_for_manager(p_cycle_id) -- RESTATED IN FULL.
--    Unchanged except has_full_proposal, which no longer counts a withdrawn
--    child (so the manager's Invite button reappears).
--
--    Withdrawn proposals are still RETURNED as ordinary rows -- the manager
--    should see that the invitation existed and was withdrawn.
-- ----------------------------------------------------------------------------
create or replace function public.list_cycle_proposals_for_manager(p_cycle_id uuid)
returns table (
  proposal_id            uuid,
  title                  text,
  type                   text,
  state                  text,
  outcome                text,
  requested_amount       numeric,
  funded_amount          numeric,
  year_number            int,
  submitted_at           timestamptz,
  parent_proposal_id     uuid,
  project_id             uuid,
  researcher_id          uuid,
  researcher_name        text,
  researcher_institution text,
  has_full_proposal      boolean
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not public.is_manager(auth.uid()) then
    raise exception 'Only a manager may list cycle proposals'
      using errcode = '42501';
  end if;

  return query
  select
    p.id,
    p.title,
    p.type,
    p.state,
    p.outcome,
    p.requested_amount,
    p.funded_amount,
    p.year_number,
    p.submitted_at,
    p.parent_proposal_id,
    p.project_id,
    p.researcher_id,
    prof.full_name,
    prof.institution,
    exists (
      select 1 from public.proposals c
      where c.parent_proposal_id = p.id
        and c.state <> 'withdrawn'
    ) as has_full_proposal
  from public.proposals p
  join public.profiles prof on prof.id = p.researcher_id
  where p.cycle_id = p_cycle_id
  order by p.submitted_at nulls last, p.created_at;
end;
$$;

revoke all on function public.list_cycle_proposals_for_manager(uuid) from public, anon;
grant execute on function public.list_cycle_proposals_for_manager(uuid) to authenticated;

-- ----------------------------------------------------------------------------
-- 6. list_continuation_candidates(p_cycle_id) -- RESTATED IN FULL.
--    Unchanged except the duplicate-invitation guard, which now ignores a
--    withdrawn proposal. Without this the project would never reappear as a
--    candidate and the manager would have no way to re-invite it.
--
--    The `funded` CTE needs no change: a withdrawn proposal is a draft and can
--    never carry outcome = 'funded', so it cannot establish a lineage.
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
        and x.state <> 'withdrawn'                -- a withdrawn one doesn't count
    )
  order by prof.full_name, pr.title;
end;
$$;

revoke all on function public.list_continuation_candidates(uuid) from public, anon;
grant execute on function public.list_continuation_candidates(uuid) to authenticated;

-- ----------------------------------------------------------------------------
-- 7. invite_continuation(p_project_id, p_cycle_id) -- RESTATED IN FULL.
--    Unchanged except the "already has a proposal in this cycle" guard, which
--    now ignores a withdrawn proposal.
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
  -- proposal in this cycle. A WITHDRAWN one does not count -- that invitation
  -- was un-issued, so a replacement is allowed.
  if exists (
    select 1 from public.proposals x
    where x.project_id = p_project_id
      and x.cycle_id = p_cycle_id
      and x.state <> 'withdrawn'
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
