-- ============================================================================
-- Migration: funding decisions + allocation tally RPCs (manager-only)
-- In the deliberation meeting the Manager records a funding decision per
-- submitted full/continuation/off-cycle proposal (a funded amount may be less
-- than requested). A live tally shows total available, allocated, and
-- remaining. Off-cycle funding comes from a separate source and does NOT count
-- against the annual pool.
--
-- Reuses existing function: public.is_manager(uuid). Sets the existing
-- app.proposal_rpc transaction-local bypass flag so the proposal guard permits
-- these sanctioned writes.
--
-- NOTE: apply by pasting into the Supabase dashboard SQL editor.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. set_funding_decision(p_id, p_funded, p_amount)
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
  v_type  text;
  v_state text;
begin
  if not public.is_manager(auth.uid()) then
    raise exception 'Only a manager may record a funding decision'
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
end;
$$;

revoke all on function public.set_funding_decision(uuid, boolean, numeric) from public, anon;
grant execute on function public.set_funding_decision(uuid, boolean, numeric) to authenticated;

-- ----------------------------------------------------------------------------
-- 2. clear_funding_decision(p_id) -- undo a decision entirely
-- ----------------------------------------------------------------------------
create or replace function public.clear_funding_decision(p_id uuid)
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
    raise exception 'Only a manager may clear a funding decision'
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
    raise exception 'Only a submitted proposal can have its funding decision cleared'
      using errcode = '42501';
  end if;
  if v_type not in ('full', 'continuation', 'off_cycle') then
    raise exception 'Pre-proposals do not have funding decisions'
      using errcode = '42501';
  end if;

  perform set_config('app.proposal_rpc', 'on', true);
  update public.proposals
  set outcome = null, funded_amount = null
  where id = p_id;
  perform set_config('app.proposal_rpc', 'off', true);
end;
$$;

revoke all on function public.clear_funding_decision(uuid) from public, anon;
grant execute on function public.clear_funding_decision(uuid) to authenticated;

-- ----------------------------------------------------------------------------
-- 3. cycle_funding_summary(p_cycle_id) -- the live allocation tally
--    Off-cycle allocations are reported separately and excluded from the pool.
-- ----------------------------------------------------------------------------
create or replace function public.cycle_funding_summary(p_cycle_id uuid)
returns table (
  total_budget       numeric,
  allocated          numeric,
  remaining          numeric,
  requested_total    numeric,
  decided_count      int,
  undecided_count    int,
  offcycle_allocated numeric
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_budget    numeric;
  v_allocated numeric;
begin
  if not public.is_manager(auth.uid()) then
    raise exception 'Only a manager may view the funding summary'
      using errcode = '42501';
  end if;

  select coalesce(c.total_budget, 0) into v_budget
  from public.cycles c
  where c.id = p_cycle_id;
  v_budget := coalesce(v_budget, 0);  -- cycle not found -> 0

  -- Pool allocation excludes off_cycle (separate funding source).
  select coalesce(sum(p.funded_amount) filter (
           where p.outcome = 'funded' and p.type in ('full', 'continuation')), 0)
    into v_allocated
  from public.proposals p
  where p.cycle_id = p_cycle_id;

  return query
  select
    v_budget                                   as total_budget,
    v_allocated                                as allocated,
    (v_budget - v_allocated)                   as remaining,   -- may go negative
    coalesce(sum(p.requested_amount) filter (
      where p.state = 'submitted'
        and p.type in ('full', 'continuation')), 0)::numeric   as requested_total,
    coalesce(count(*) filter (
      where p.state = 'submitted'
        and p.type in ('full', 'continuation')
        and p.outcome is not null), 0)::int                    as decided_count,
    coalesce(count(*) filter (
      where p.state = 'submitted'
        and p.type in ('full', 'continuation')
        and p.outcome is null), 0)::int                        as undecided_count,
    coalesce(sum(p.funded_amount) filter (
      where p.outcome = 'funded' and p.type = 'off_cycle'), 0)::numeric
                                                               as offcycle_allocated
  from public.proposals p
  where p.cycle_id = p_cycle_id;
end;
$$;

revoke all on function public.cycle_funding_summary(uuid) from public, anon;
grant execute on function public.cycle_funding_summary(uuid) to authenticated;
