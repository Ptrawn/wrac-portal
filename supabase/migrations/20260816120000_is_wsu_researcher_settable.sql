-- ============================================================================
-- Migration: make is_wsu researcher-settable and manager-overridable
--
-- Model change from the ARC migration: is_wsu is no longer manager-only. The
-- RESEARCHER ticks a "WSU researcher" checkbox on their own proposal (editable
-- while draft/reopened, like requested_amount and the four WSU line items), and
-- the MANAGER can confirm or override it at any time -- including after
-- submission, before funding -- via a dedicated RPC.
--
-- arc_amount stays protected: only the funding RPC (set_funding_decision) ever
-- sets it. This migration does NOT touch arc_amount, the ARC columns, the
-- ceiling helper, set_funding_decision, or cycle_funding_summary.
--
-- Reuses existing functions: public.is_manager(uuid). Does NOT redefine them.
--
-- NOTE: apply by pasting into the Supabase dashboard SQL editor.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. Proposal owner-guard -- RESTATED in full.
--    Change vs the ARC migration: is_wsu is REMOVED from the UPDATE
--    protected-change list, so a researcher may set it while the proposal is in
--    draft/reopened (the guard is a blacklist -- omission = editable). is_wsu
--    was already allowed at INSERT. Everything else is unchanged.
--
--    After this migration, for a researcher editing their OWN proposal:
--      EDITABLE while draft/reopened (not in the protected list):
--        requested_amount, is_wsu, wsu_salary, wsu_salary_benefits, wsu_wages,
--        wsu_wage_benefits, title, year_number, etc.
--      PROTECTED (never researcher-editable; RPC/manager only):
--        outcome, funded_amount, arc_amount, state, submitted_at, reopened_at,
--        rescinded_at, cycle_id, researcher_id, project_id, type.
--    A submitted/rescinded proposal remains fully locked to the researcher
--    (the old.state gate), so is_wsu is only researcher-editable pre-submission.
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
  -- funding field and must likewise be null on a fresh draft. (is_wsu may be set
  -- at creation.)
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

  -- (b) these fields are set only via the RPCs or by a manager. arc_amount is
  -- set only by the funding RPC. is_wsu is NOT here anymore -- the researcher may
  -- toggle the "WSU researcher" flag while draft/reopened; the manager can
  -- confirm/override it any time via set_proposal_wsu. The four WSU line items
  -- and requested_amount are likewise owner-editable while draft/reopened.
  if new.outcome        is distinct from old.outcome
     or new.funded_amount is distinct from old.funded_amount
     or new.arc_amount    is distinct from old.arc_amount
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
-- 2. set_proposal_wsu(p_id, p_is_wsu) -- manager confirm/override of the WSU
--    flag, at ANY proposal state (draft or submitted, before funding). Uses the
--    app.proposal_rpc bypass so the sanctioned write passes the owner guard.
-- ----------------------------------------------------------------------------
create or replace function public.set_proposal_wsu(p_id uuid, p_is_wsu boolean)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_exists boolean;
begin
  if not public.is_manager(auth.uid()) then
    raise exception 'Only a manager may set the WSU flag on a proposal'
      using errcode = '42501';
  end if;

  select true into v_exists
  from public.proposals
  where id = p_id
  for update;

  if v_exists is null then
    raise exception 'Proposal not found' using errcode = 'P0002';
  end if;

  perform set_config('app.proposal_rpc', 'on', true);
  update public.proposals
  set is_wsu = coalesce(p_is_wsu, false)
  where id = p_id;
  perform set_config('app.proposal_rpc', 'off', true);
end;
$$;

revoke all on function public.set_proposal_wsu(uuid, boolean) from public, anon;
grant execute on function public.set_proposal_wsu(uuid, boolean) to authenticated;
