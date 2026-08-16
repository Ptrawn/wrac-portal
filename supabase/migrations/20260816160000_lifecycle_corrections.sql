-- ============================================================================
-- Migration: lifecycle corrections (manager) -- un-rescind, un-end, no-cost
-- extension, and a below-request funding note.
--
-- Four manager-only corrections/adjustments to proposal/project lifecycle:
--   1. unrescind_proposal      -- undo an accidental researcher rescind
--   2. unend_project           -- reverse an accidental end_project
--   3. grant/revoke_no_cost_extension -- extend time to COMPLETE, no new funding
--   4. funding_note on set_funding_decision -- record why funded below request
--
-- Reuses existing functions: public.is_manager(uuid), public.set_updated_at().
-- Does NOT redefine them. Restates the proposal guard, the project guard,
-- set_funding_decision, and clear_funding_decision in full.
--
-- NCE SAFETY (see item 3): a no-cost extension must NEVER make a project
-- eligible for another FUNDED year. It writes only the four nce_* fields and
-- touches NEITHER planned_years NOR status, and continuation eligibility
-- (list_continuation_candidates / invite_continuation) reads only status,
-- planned_years vs. max funded year, and duplicate-in-cycle -- never any nce_*
-- field. So granting an NCE cannot add a project to the continuation candidates.
-- Confirmed by inspection; those two functions are intentionally NOT modified.
--
-- NOTE: apply by pasting into the Supabase dashboard SQL editor.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. New columns
-- ----------------------------------------------------------------------------
alter table public.proposals
  add column if not exists funding_note text;
comment on column public.proposals.funding_note is
  'Manager''s note on the funding decision -- especially the reasoning when a '
  'proposal is funded below the requested amount. Set only via '
  'set_funding_decision; cleared when not funded or when the decision is cleared. '
  'Not researcher-editable (guarded).';

alter table public.projects
  add column if not exists nce_granted boolean not null default false;
alter table public.projects
  add column if not exists nce_granted_at timestamptz;
alter table public.projects
  add column if not exists nce_reason text;
alter table public.projects
  add column if not exists nce_extended_to date;
comment on column public.projects.nce_granted is
  'A no-cost extension gives the project more time to COMPLETE existing work with '
  'NO additional funding. It deliberately does NOT change planned_years or status, '
  'so it never makes the project a continuation candidate / eligible for another '
  'funded year. Set only via grant_no_cost_extension.';

-- ----------------------------------------------------------------------------
-- 2. Proposal owner-guard -- RESTATED. funding_note is a funding-decision field:
--    it must be null on a fresh researcher draft (INSERT check) and is protected
--    from researcher changes (UPDATE list), like funded_amount / arc_amount.
--    is_wsu stays researcher-settable (unchanged from the prior migration).
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
  -- outcome/amount/timestamp/funding fields are RPC/manager territory.
  if tg_op = 'INSERT' then
    if new.state <> 'draft'
       or new.outcome is not null
       or new.funded_amount is not null
       or new.arc_amount is not null
       or new.funding_note is not null
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

  -- (b) these fields are set only via the RPCs or by a manager. funding_note is
  -- set only by the funding RPC. is_wsu and the four WSU line items remain
  -- owner-editable while draft/reopened and are intentionally ABSENT here.
  if new.outcome        is distinct from old.outcome
     or new.funded_amount is distinct from old.funded_amount
     or new.arc_amount    is distinct from old.arc_amount
     or new.funding_note  is distinct from old.funding_note
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

drop trigger if exists trg_proposals_owner_rules on public.proposals;
create trigger trg_proposals_owner_rules
  before insert or update on public.proposals
  for each row
  execute function public.enforce_proposal_owner_rules();

-- ----------------------------------------------------------------------------
-- 3. Project owner-guard -- RESTATED. The four nce_* fields are manager/RPC-only
--    (grant/revoke_no_cost_extension), so a fresh researcher project must not
--    preset them (INSERT check) and a researcher may not change them (UPDATE
--    list). Title and planned_years stay owner-editable, as before.
-- ----------------------------------------------------------------------------
create or replace function public.enforce_project_owner_rules()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  -- Sanctioned RPC path: this txn-local flag is set only by the project RPCs.
  if current_setting('app.project_rpc', true) = 'on' then
    return new;
  end if;

  -- Admin (dashboard, auth.uid() null) or manager: allow everything.
  if auth.uid() is null or public.is_manager(auth.uid()) then
    return new;
  end if;

  -- Researcher INSERT: a new project must start proposed, not ended, no final
  -- report flagged, and with no no-cost extension preset.
  if tg_op = 'INSERT' then
    if new.status <> 'proposed'
       or new.final_report_required <> false
       or new.ended_at is not null
       or new.nce_granted <> false
       or new.nce_granted_at is not null
       or new.nce_reason is not null
       or new.nce_extended_to is not null
    then
      raise exception 'A new project must start as proposed'
        using errcode = '42501';
    end if;
    return new;
  end if;

  -- Researcher UPDATE: these fields are set only via the project RPCs or by a
  -- manager. Title and planned_years stay owner-editable.
  if new.status                is distinct from old.status
     or new.ended_at              is distinct from old.ended_at
     or new.ended_reason          is distinct from old.ended_reason
     or new.final_report_required is distinct from old.final_report_required
     or new.researcher_id         is distinct from old.researcher_id
     or new.nce_granted           is distinct from old.nce_granted
     or new.nce_granted_at        is distinct from old.nce_granted_at
     or new.nce_reason            is distinct from old.nce_reason
     or new.nce_extended_to       is distinct from old.nce_extended_to
  then
    raise exception 'You are not allowed to change that field on a project'
      using errcode = '42501';
  end if;

  return new;
end;
$$;

drop trigger if exists trg_projects_owner_rules on public.projects;
create trigger trg_projects_owner_rules
  before insert or update on public.projects
  for each row
  execute function public.enforce_project_owner_rules();

-- ----------------------------------------------------------------------------
-- 4. unrescind_proposal(p_id) -- manager undoes an accidental rescind.
--    We don't store the pre-rescind state, so: submitted_at not null -> restore
--    'submitted', else 'draft'. Clears rescinded_at. Uses app.proposal_rpc.
-- ----------------------------------------------------------------------------
create or replace function public.unrescind_proposal(p_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_state        text;
  v_submitted_at timestamptz;
  v_new_state    text;
begin
  if not public.is_manager(auth.uid()) then
    raise exception 'Only a manager may un-rescind a proposal' using errcode = '42501';
  end if;

  select state, submitted_at into v_state, v_submitted_at
  from public.proposals
  where id = p_id
  for update;

  if v_state is null then
    raise exception 'Proposal not found' using errcode = 'P0002';
  end if;
  if v_state <> 'rescinded' then
    raise exception
      'Only a rescinded proposal can be un-rescinded (this one is %).', v_state
      using errcode = '42501';
  end if;

  v_new_state := case when v_submitted_at is not null then 'submitted' else 'draft' end;

  perform set_config('app.proposal_rpc', 'on', true);
  update public.proposals
  set state = v_new_state,
      rescinded_at = null
  where id = p_id;
  perform set_config('app.proposal_rpc', 'off', true);
end;
$$;

revoke all on function public.unrescind_proposal(uuid) from public, anon;
grant execute on function public.unrescind_proposal(uuid) to authenticated;

-- ----------------------------------------------------------------------------
-- 5. unend_project(p_project_id) -- manager reverses an accidental end_project.
--    Restore status to 'active' if the project has any funded proposal, else
--    'proposed'. Clear ended_at / ended_reason. Reset final_report_required to
--    false ONLY if no final report has actually been submitted; if one has been
--    submitted, leave the flag as-is (the obligation was real). Note: because
--    submit_report moves a project to 'completed' (not 'ended') when a final is
--    submitted, an 'ended' project normally has no submitted final report -- the
--    guard below is a defensive no-op in that normal case. Uses app.project_rpc.
-- ----------------------------------------------------------------------------
create or replace function public.unend_project(p_project_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_status     text;
  v_has_funded boolean;
  v_has_final  boolean;
  v_new_status text;
begin
  if not public.is_manager(auth.uid()) then
    raise exception 'Only a manager may un-end a project' using errcode = '42501';
  end if;

  select status into v_status
  from public.projects
  where id = p_project_id
  for update;

  if v_status is null then
    raise exception 'Project not found' using errcode = 'P0002';
  end if;
  if v_status <> 'ended' then
    raise exception
      'Only an ended project can be un-ended (this one is %).', v_status
      using errcode = '42501';
  end if;

  select exists (
    select 1 from public.proposals p
    where p.project_id = p_project_id and p.outcome = 'funded'
  ) into v_has_funded;
  v_new_status := case when v_has_funded then 'active' else 'proposed' end;

  select exists (
    select 1 from public.reports r
    where r.project_id = p_project_id
      and r.type = 'final'
      and r.state = 'submitted'
  ) into v_has_final;

  perform set_config('app.project_rpc', 'on', true);
  update public.projects
  set status = v_new_status,
      ended_at = null,
      ended_reason = null,
      -- keep the flag if a final report was really submitted; else clear it.
      final_report_required = case when v_has_final then final_report_required else false end
  where id = p_project_id;
  perform set_config('app.project_rpc', 'off', true);
end;
$$;

revoke all on function public.unend_project(uuid) from public, anon;
grant execute on function public.unend_project(uuid) to authenticated;

-- ----------------------------------------------------------------------------
-- 6. grant_no_cost_extension / revoke_no_cost_extension -- manager-only.
--    Grant sets the four nce_* fields; the project must not be completed or
--    declined. Revoke clears them. NEITHER touches planned_years or status, so
--    NEITHER affects continuation eligibility. Uses app.project_rpc.
-- ----------------------------------------------------------------------------
create or replace function public.grant_no_cost_extension(
  p_project_id uuid,
  p_reason     text,
  p_extended_to date
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_status text;
begin
  if not public.is_manager(auth.uid()) then
    raise exception 'Only a manager may grant a no-cost extension'
      using errcode = '42501';
  end if;

  select status into v_status
  from public.projects
  where id = p_project_id
  for update;

  if v_status is null then
    raise exception 'Project not found' using errcode = 'P0002';
  end if;
  if v_status in ('completed', 'declined') then
    raise exception 'A % project cannot receive a no-cost extension', v_status
      using errcode = '42501';
  end if;

  perform set_config('app.project_rpc', 'on', true);
  update public.projects
  set nce_granted     = true,
      nce_granted_at  = now(),
      nce_reason      = p_reason,
      nce_extended_to = p_extended_to
  where id = p_project_id;
  perform set_config('app.project_rpc', 'off', true);
end;
$$;

revoke all on function public.grant_no_cost_extension(uuid, text, date) from public, anon;
grant execute on function public.grant_no_cost_extension(uuid, text, date) to authenticated;

create or replace function public.revoke_no_cost_extension(p_project_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_status text;
begin
  if not public.is_manager(auth.uid()) then
    raise exception 'Only a manager may revoke a no-cost extension'
      using errcode = '42501';
  end if;

  select status into v_status
  from public.projects
  where id = p_project_id
  for update;

  if v_status is null then
    raise exception 'Project not found' using errcode = 'P0002';
  end if;

  perform set_config('app.project_rpc', 'on', true);
  update public.projects
  set nce_granted     = false,
      nce_granted_at  = null,
      nce_reason      = null,
      nce_extended_to = null
  where id = p_project_id;
  perform set_config('app.project_rpc', 'off', true);
end;
$$;

revoke all on function public.revoke_no_cost_extension(uuid) from public, anon;
grant execute on function public.revoke_no_cost_extension(uuid) to authenticated;

-- ----------------------------------------------------------------------------
-- 7. set_funding_decision -- RESTATED with an optional funding note. Signature
--    grows from (uuid, boolean, numeric, numeric) to
--    (uuid, boolean, numeric, numeric, text), both defaulted, so the old 4-arg
--    version is dropped first (avoids an ambiguous overload for default calls).
--
--    Preserved exactly: manager gate; proposal-not-found; submitted-state;
--    full/continuation/off_cycle type filter; funded-amount validation;
--    re-decidable (no budget cap); the FULL WSU ARC logic (arc<0, arc>amount,
--    arc>ceiling checks; non-WSU forces arc null and ignores p_arc_amount);
--    not-funded clears funded_amount + arc_amount; project 'proposed'->'active'
--    promotion; both app.proposal_rpc and app.project_rpc bypass flags.
--
--    Added: store p_funding_note in funding_note when funding; clear it (null)
--    when not funded. Omitting the note (default null) on a funded decision
--    stores null -- backward compatible with existing 4-arg calls.
-- ----------------------------------------------------------------------------
drop function if exists public.set_funding_decision(uuid, boolean, numeric, numeric);

create or replace function public.set_funding_decision(
  p_id uuid,
  p_funded boolean,
  p_amount numeric,
  p_arc_amount numeric default 0,
  p_funding_note text default null
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
      set outcome = 'funded', funded_amount = p_amount, arc_amount = v_arc,
          funding_note = p_funding_note
      where id = p_id;
    else
      -- Non-WSU: ARC does not apply. Force arc_amount null, ignore p_arc_amount.
      update public.proposals
      set outcome = 'funded', funded_amount = p_amount, arc_amount = null,
          funding_note = p_funding_note
      where id = p_id;
    end if;
  else
    update public.proposals
    set outcome = 'not_funded', funded_amount = null, arc_amount = null,
        funding_note = null
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

revoke all on function public.set_funding_decision(uuid, boolean, numeric, numeric, text) from public, anon;
grant execute on function public.set_funding_decision(uuid, boolean, numeric, numeric, text) to authenticated;

-- ----------------------------------------------------------------------------
-- 8. clear_funding_decision -- RESTATED. Clears the decision entirely, now also
--    nulling funding_note AND arc_amount (the prior version left arc_amount set;
--    a fully-cleared decision should carry no ARC or note). Manager-only checks
--    and the app.proposal_rpc bypass are unchanged.
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
  set outcome = null, funded_amount = null, arc_amount = null, funding_note = null
  where id = p_id;
  perform set_config('app.proposal_rpc', 'off', true);
end;
$$;

revoke all on function public.clear_funding_decision(uuid) from public, anon;
grant execute on function public.clear_funding_decision(uuid) to authenticated;
