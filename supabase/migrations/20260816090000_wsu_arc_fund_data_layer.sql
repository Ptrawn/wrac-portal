-- ============================================================================
-- Migration: WSU ARC fund data layer
--
-- WSU has a SEPARATE fixed pot of money per cycle (the "ARC fund") that covers
-- wages and benefits for WSU researchers only. It is distinct from the main
-- annual pool. The manager sets the ARC fund total per cycle.
--
-- A full/continuation proposal from a WSU researcher breaks out four
-- INFORMATIONAL budget line items (WSU Salary, Salary Benefits, Wages, Wage
-- Benefits). These do NOT reconcile against requested_amount -- they are
-- detail, and their SUM is the "ARC-eligible ceiling" for that proposal.
--
-- At funding, for a funded WSU project, the manager records a single
-- "amount to ARC" (arc_amount), capped at that ceiling and at the funded
-- amount. The amount to ARC REDUCES what the project draws from the main pool:
--     pool draw = funded_amount - arc_amount
-- Every dollar sent to ARC frees a dollar back into the main pool.
--
-- Reuses existing functions: public.is_manager(uuid),
-- public.is_approved_researcher(uuid), public.set_updated_at(). Does NOT
-- redefine them. Amends the proposal guard, set_funding_decision, and
-- cycle_funding_summary -- preserving every prior check.
--
-- NOTE: apply by pasting into the Supabase dashboard SQL editor.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. cycles.arc_fund_total -- the per-cycle ARC pot. Nullable: not every cycle
--    uses ARC. Editable any time before funding is finalised (manager RLS).
-- ----------------------------------------------------------------------------
alter table public.cycles
  add column if not exists arc_fund_total numeric(14, 2)
    check (arc_fund_total is null or arc_fund_total >= 0);

comment on column public.cycles.arc_fund_total is
  'The per-cycle WSU ARC fund total (wages/benefits pot for WSU researchers), '
  'separate from total_budget. Nullable -- not every cycle uses ARC.';

-- ----------------------------------------------------------------------------
-- 2. proposals: WSU flag, four informational line items, and arc_amount.
-- ----------------------------------------------------------------------------
alter table public.proposals
  add column if not exists is_wsu boolean not null default false;
alter table public.proposals
  add column if not exists wsu_salary numeric(14, 2)
    check (wsu_salary is null or wsu_salary >= 0);
alter table public.proposals
  add column if not exists wsu_salary_benefits numeric(14, 2)
    check (wsu_salary_benefits is null or wsu_salary_benefits >= 0);
alter table public.proposals
  add column if not exists wsu_wages numeric(14, 2)
    check (wsu_wages is null or wsu_wages >= 0);
alter table public.proposals
  add column if not exists wsu_wage_benefits numeric(14, 2)
    check (wsu_wage_benefits is null or wsu_wage_benefits >= 0);
alter table public.proposals
  add column if not exists arc_amount numeric(14, 2)
    check (arc_amount is null or arc_amount >= 0);

comment on column public.proposals.is_wsu is
  'True when this proposal belongs to a WSU researcher. Set AT CREATION from the '
  'researcher''s institution and stored on the proposal so it stays stable even '
  'if the profile institution later changes. Not researcher-editable after '
  'creation (guarded) and never set by the funding RPC.';
comment on column public.proposals.wsu_salary is
  'Informational WSU budget line item. Does NOT reconcile against '
  'requested_amount. Part of the ARC-eligible ceiling (sum of the four items).';
comment on column public.proposals.wsu_salary_benefits is
  'Informational WSU budget line item (see wsu_salary).';
comment on column public.proposals.wsu_wages is
  'Informational WSU budget line item (see wsu_salary).';
comment on column public.proposals.wsu_wage_benefits is
  'Informational WSU budget line item (see wsu_salary).';
comment on column public.proposals.arc_amount is
  'Amount of a funded WSU award covered by the ARC fund. Null until a funding '
  'decision sets it, and only ever set by set_funding_decision (never by the '
  'researcher). Capped at proposal_arc_ceiling and at funded_amount.';

-- ----------------------------------------------------------------------------
-- 3. proposal_arc_ceiling(p_id) -- the cap on arc_amount: the sum of the four
--    WSU line items (nulls coalesced to 0). SECURITY DEFINER + STABLE.
-- ----------------------------------------------------------------------------
create or replace function public.proposal_arc_ceiling(p_id uuid)
returns numeric
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(wsu_salary, 0)
       + coalesce(wsu_salary_benefits, 0)
       + coalesce(wsu_wages, 0)
       + coalesce(wsu_wage_benefits, 0)
  from public.proposals
  where id = p_id;
$$;

revoke all on function public.proposal_arc_ceiling(uuid) from public, anon;
grant execute on function public.proposal_arc_ceiling(uuid) to authenticated;

-- ----------------------------------------------------------------------------
-- 4. Proposal owner-guard -- RESTATED in full.
--    How the six new columns are handled:
--      * wsu_salary, wsu_salary_benefits, wsu_wages, wsu_wage_benefits
--        -- researcher-editable content like requested_amount. The guard is a
--        blacklist, so leaving them OUT of the protected-change list keeps them
--        editable; the existing draft/reopened lock (old.state check) confines
--        edits to draft/reopened, exactly as for requested_amount.
--      * arc_amount -- funding-decision field. Added to the INSERT clean-draft
--        check (must be null on a new researcher draft, like funded_amount) AND
--        to the UPDATE protected-change list (researchers cannot change it).
--      * is_wsu -- set at creation, then immutable to the researcher. Added to
--        the UPDATE protected-change list. Left settable at INSERT because it is
--        assigned at creation from the researcher's institution (the creation
--        flow is responsible for deriving it; a manager/admin/RPC path may also
--        set it).
--    Everything else about the guard is unchanged.
-- ----------------------------------------------------------------------------
create or replace function public.enforce_proposal_owner_rules()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  -- Sanctioned RPC path: this txn-local flag is set only by the RPCs.
  if current_setting('app.proposal_rpc', true) = 'on' then
    return new;
  end if;

  -- Admin (dashboard, auth.uid() null) or manager: allow everything.
  if auth.uid() is null or public.is_manager(auth.uid()) then
    return new;
  end if;

  -- Researcher INSERT: a new proposal must start as a clean draft -- the
  -- outcome/amount/timestamp columns are RPC/manager territory. arc_amount is a
  -- funding field and must likewise be null on a fresh draft.
  if tg_op = 'INSERT' then
    if new.state <> 'draft'
       or new.outcome is not null
       or new.funded_amount is not null
       or new.arc_amount is not null
       or new.submitted_at is not null
       or new.reopened_at is not null
       or new.rescinded_at is not null
    then
      raise exception 'A new proposal must start as a clean draft'
        using errcode = '42501';
    end if;
    return new;
  end if;

  -- Researcher UPDATE on their own row:
  -- (a) a submitted/rescinded proposal is locked entirely.
  if old.state not in ('draft', 'reopened') then
    raise exception 'This proposal is locked and can no longer be edited'
      using errcode = '42501';
  end if;

  -- (b) these fields are set only via the RPCs or by a manager. is_wsu is fixed
  -- at creation; arc_amount is set only by the funding RPC. The four WSU line
  -- items are intentionally ABSENT here -- they are owner-editable while
  -- draft/reopened, just like requested_amount.
  if new.outcome        is distinct from old.outcome
     or new.funded_amount is distinct from old.funded_amount
     or new.arc_amount    is distinct from old.arc_amount
     or new.is_wsu        is distinct from old.is_wsu
     or new.state         is distinct from old.state
     or new.submitted_at  is distinct from old.submitted_at
     or new.reopened_at   is distinct from old.reopened_at
     or new.rescinded_at  is distinct from old.rescinded_at
     or new.cycle_id      is distinct from old.cycle_id
     or new.researcher_id is distinct from old.researcher_id
     or new.project_id    is distinct from old.project_id
     or new.type          is distinct from old.type
  then
    raise exception 'You are not allowed to change that field on a proposal'
      using errcode = '42501';
  end if;

  return new;
end;
$$;

-- Trigger definition unchanged; restated for a self-contained apply.
drop trigger if exists trg_proposals_owner_rules on public.proposals;
create trigger trg_proposals_owner_rules
  before insert or update on public.proposals
  for each row
  execute function public.enforce_proposal_owner_rules();

-- ----------------------------------------------------------------------------
-- 5. set_funding_decision -- RESTATED in full with an optional ARC parameter.
--    Signature changes from (uuid, boolean, numeric) to
--    (uuid, boolean, numeric, numeric default 0), so the old 3-arg version is
--    dropped first (avoids an ambiguous overload for default-arg calls).
--
--    Preserved exactly: manager gate; proposal-not-found; submitted-state
--    requirement; full/continuation/off_cycle type filter; re-decidable (no
--    budget cap); funded-amount validation; project 'proposed' -> 'active'
--    promotion; the app.proposal_rpc and app.project_rpc bypass flags.
--
--    Added: on a funded WSU proposal, record arc_amount = p_arc_amount, but
--    reject arc < 0, arc > funded amount, or arc > the ARC-eligible ceiling
--    (sum of the four line items). A funded non-WSU proposal forces arc_amount
--    to null and ignores p_arc_amount. A not-funded decision clears arc_amount.
--    Calling without p_arc_amount (default 0) is identical to the old behaviour
--    for non-WSU proposals.
-- ----------------------------------------------------------------------------
drop function if exists public.set_funding_decision(uuid, boolean, numeric);

create or replace function public.set_funding_decision(
  p_id uuid,
  p_funded boolean,
  p_amount numeric,
  p_arc_amount numeric default 0
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
  v_is_wsu  boolean;
  v_ceiling numeric;
  v_arc     numeric;
begin
  if not public.is_manager(auth.uid()) then
    raise exception 'Only a manager may record a funding decision'
      using errcode = '42501';
  end if;

  select type, state, project_id, is_wsu
    into v_type, v_state, v_project, v_is_wsu
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

    if v_is_wsu then
      -- ARC applies only to WSU proposals. Validate the amount to ARC.
      v_arc := coalesce(p_arc_amount, 0);
      if v_arc < 0 then
        raise exception 'The amount to ARC cannot be negative'
          using errcode = '22023';
      end if;
      if v_arc > p_amount then
        raise exception
          'The amount to ARC (%) cannot exceed the funded amount (%).',
          v_arc, p_amount
          using errcode = '22023';
      end if;
      v_ceiling := coalesce(public.proposal_arc_ceiling(p_id), 0);
      if v_arc > v_ceiling then
        raise exception
          'The amount to ARC (%) exceeds the ARC-eligible ceiling (%).',
          v_arc, v_ceiling
          using errcode = '22023';
      end if;

      update public.proposals
      set outcome = 'funded', funded_amount = p_amount, arc_amount = v_arc
      where id = p_id;
    else
      -- Non-WSU: ARC does not apply. Force arc_amount null, ignore p_arc_amount.
      update public.proposals
      set outcome = 'funded', funded_amount = p_amount, arc_amount = null
      where id = p_id;
    end if;
  else
    update public.proposals
    set outcome = 'not_funded', funded_amount = null, arc_amount = null
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

revoke all on function public.set_funding_decision(uuid, boolean, numeric, numeric) from public, anon;
grant execute on function public.set_funding_decision(uuid, boolean, numeric, numeric) to authenticated;

-- ----------------------------------------------------------------------------
-- 6. cycle_funding_summary -- RESTATED in full, ARC-aware. The return shape
--    grows (three new columns), so the old version is dropped first.
--
--    'allocated' now sums the POOL DRAW (funded_amount - coalesce(arc_amount,0))
--    for funded full/continuation proposals -- net of ARC -- and 'remaining' is
--    total_budget minus that. All existing fields are preserved. New fields:
--      arc_fund_total  -- cycles.arc_fund_total (0 if null / cycle not found)
--      arc_allocated   -- sum(arc_amount) for funded full/continuation props
--      arc_remaining   -- arc_fund_total - arc_allocated (may go negative)
--    Non-WSU funded proposals have arc_amount null -> pool draw == funded_amount,
--    so behaviour is unchanged where ARC is not used.
-- ----------------------------------------------------------------------------
drop function if exists public.cycle_funding_summary(uuid);

create or replace function public.cycle_funding_summary(p_cycle_id uuid)
returns table (
  total_budget       numeric,
  allocated          numeric,
  remaining          numeric,
  requested_total    numeric,
  decided_count      int,
  undecided_count    int,
  offcycle_allocated numeric,
  arc_fund_total     numeric,
  arc_allocated      numeric,
  arc_remaining      numeric
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_budget    numeric;
  v_allocated numeric;   -- net pool draw (funded_amount - arc_amount)
  v_arc_total numeric;
  v_arc_alloc numeric;
begin
  if not public.is_manager(auth.uid()) then
    raise exception 'Only a manager may view the funding summary'
      using errcode = '42501';
  end if;

  select coalesce(c.total_budget, 0), coalesce(c.arc_fund_total, 0)
    into v_budget, v_arc_total
  from public.cycles c
  where c.id = p_cycle_id;
  v_budget    := coalesce(v_budget, 0);      -- cycle not found -> 0
  v_arc_total := coalesce(v_arc_total, 0);   -- cycle not found -> 0

  -- Pool allocation excludes off_cycle (separate source) and nets out ARC:
  -- every dollar moved to ARC is freed back into the main pool. arc_allocated
  -- is the sum of those ARC dollars across funded full/continuation proposals.
  select
    coalesce(sum(p.funded_amount - coalesce(p.arc_amount, 0)) filter (
      where p.outcome = 'funded' and p.type in ('full', 'continuation')), 0),
    coalesce(sum(p.arc_amount) filter (
      where p.outcome = 'funded' and p.type in ('full', 'continuation')), 0)
    into v_allocated, v_arc_alloc
  from public.proposals p
  where p.cycle_id = p_cycle_id;

  return query
  select
    v_budget                                   as total_budget,
    v_allocated                                as allocated,     -- net of ARC
    (v_budget - v_allocated)                   as remaining,     -- may go negative
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
                                                               as offcycle_allocated,
    v_arc_total                                as arc_fund_total,
    v_arc_alloc                                as arc_allocated,
    (v_arc_total - v_arc_alloc)                as arc_remaining  -- may go negative
  from public.proposals p
  where p.cycle_id = p_cycle_id;
end;
$$;

revoke all on function public.cycle_funding_summary(uuid) from public, anon;
grant execute on function public.cycle_funding_summary(uuid) to authenticated;
