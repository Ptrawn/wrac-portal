-- ============================================================================
-- Migration: advance decision + full-proposal invitation RPCs (manager-only)
-- After the committee scores pre-proposals, the Manager records an outcome on
-- each ('advanced'/'declined'), then -- as a deliberate second step -- invites
-- full proposals, creating a draft for each advanced pre-proposal. Researchers
-- never start a full proposal themselves.
--
-- Reuses existing function: public.is_manager(uuid). Sets the existing
-- app.proposal_rpc transaction-local bypass flag so the proposal guard permits
-- these sanctioned writes.
--
-- NOTE: apply by pasting into the Supabase dashboard SQL editor.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. set_proposal_outcome(p_id, p_outcome) -- record advance / funding outcome
-- ----------------------------------------------------------------------------
create or replace function public.set_proposal_outcome(p_id uuid, p_outcome text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_type  text;
  v_state text;
begin
  if not public.is_manager(auth.uid()) then
    raise exception 'Only a manager may set a proposal outcome'
      using errcode = '42501';
  end if;

  select type, state into v_type, v_state
  from public.proposals
  where id = p_id
  for update;

  if v_type is null then
    raise exception 'Proposal not found' using errcode = 'P0002';
  end if;
  if v_state <> 'submitted' then
    raise exception 'Only a submitted proposal can have an outcome set'
      using errcode = '42501';
  end if;

  if v_type = 'pre' then
    if p_outcome not in ('advanced', 'declined') then
      raise exception 'A pre-proposal outcome must be advanced or declined'
        using errcode = '22023';  -- invalid_parameter_value
    end if;
  else
    if p_outcome not in ('funded', 'not_funded') then
      raise exception 'A full/off-cycle proposal outcome must be funded or not_funded'
        using errcode = '22023';
    end if;
  end if;

  -- Re-setting is allowed (a manager may correct a mistake) -- no one-way lock.
  perform set_config('app.proposal_rpc', 'on', true);
  update public.proposals
  set outcome = p_outcome
  where id = p_id;
  perform set_config('app.proposal_rpc', 'off', true);
end;
$$;

revoke all on function public.set_proposal_outcome(uuid, text) from public, anon;
grant execute on function public.set_proposal_outcome(uuid, text) to authenticated;

-- ----------------------------------------------------------------------------
-- 2. invite_full_proposal(p_pre_proposal_id) -- create the full-proposal draft
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

  -- Idempotency: the manager may click twice.
  if exists (
    select 1 from public.proposals
    where parent_proposal_id = p_pre_proposal_id
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
-- 3. list_cycle_proposals_for_manager(p_cycle_id) -- manager dashboard rows
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
    ) as has_full_proposal
  from public.proposals p
  join public.profiles prof on prof.id = p.researcher_id
  where p.cycle_id = p_cycle_id
  order by p.submitted_at nulls last, p.created_at;
end;
$$;

revoke all on function public.list_cycle_proposals_for_manager(uuid) from public, anon;
grant execute on function public.list_cycle_proposals_for_manager(uuid) to authenticated;
