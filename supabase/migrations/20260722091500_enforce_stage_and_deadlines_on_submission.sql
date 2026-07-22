-- ============================================================================
-- Migration: enforce cycle stage and deadlines on proposal submission
--
-- PROBLEM: submit_proposal previously checked only ownership and draft/reopened
-- state. Nothing verified that the cycle was actually in the stage that accepts
-- the proposal's type, or that the stage deadline had not already passed. A
-- researcher could submit a full proposal while the cycle was still
-- pre_proposal_open, or a pre-proposal weeks after its close date.
--
-- This migration:
--   1. adds proposals.late_submission_allowed (manager override),
--   2. adds RPC allow_late_submission(uuid, boolean) (manager-only),
--   3. protects the new column in the proposal owner guard trigger,
--   4. amends submit_proposal to enforce stage + deadline (with off_cycle and
--      the manager override exempt).
--
-- Review submission (submit_review) is deliberately left untouched -- a late
-- committee review is still wanted; blocking it would be counterproductive.
--
-- Reuses existing functions: public.is_manager(uuid). Does NOT redefine it.
--
-- NOTE: apply by pasting into the Supabase dashboard SQL editor.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. New column: manager override for accepting a late / out-of-stage submission
-- ----------------------------------------------------------------------------
alter table public.proposals
  add column if not exists late_submission_allowed boolean not null default false;

-- ----------------------------------------------------------------------------
-- 2. RPC: allow_late_submission -- manager-only toggle of the override.
--    Runs through the app.proposal_rpc bypass flag like the other proposal RPCs.
-- ----------------------------------------------------------------------------
create or replace function public.allow_late_submission(p_id uuid, p_allowed boolean)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not public.is_manager(auth.uid()) then
    raise exception 'Only a manager may allow a late submission' using errcode = '42501';
  end if;

  perform 1 from public.proposals where id = p_id for update;
  if not found then
    raise exception 'Proposal not found' using errcode = 'P0002';
  end if;

  perform set_config('app.proposal_rpc', 'on', true);
  update public.proposals
  set late_submission_allowed = coalesce(p_allowed, false)
  where id = p_id;
  perform set_config('app.proposal_rpc', 'off', true);
end;
$$;

revoke all on function public.allow_late_submission(uuid, boolean) from public, anon;
grant execute on function public.allow_late_submission(uuid, boolean) to authenticated;

-- ----------------------------------------------------------------------------
-- 3. Protect late_submission_allowed in the proposal owner guard trigger.
--    A researcher must not set it themselves -- it moves only via the RPC
--    above or by a manager (both take the early-return paths at the top).
--    Full body re-stated (create or replace) with the two additions marked.
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
  -- outcome/amount/timestamp columns are RPC/manager territory.
  if tg_op = 'INSERT' then
    if new.state <> 'draft'
       or new.outcome is not null
       or new.funded_amount is not null
       or new.submitted_at is not null
       or new.reopened_at is not null
       or new.rescinded_at is not null
       or new.late_submission_allowed <> false   -- (added) override is manager-only
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

  -- (b) these fields are set only via the RPCs or by a manager.
  if new.outcome        is distinct from old.outcome
     or new.funded_amount is distinct from old.funded_amount
     or new.state         is distinct from old.state
     or new.submitted_at  is distinct from old.submitted_at
     or new.reopened_at   is distinct from old.reopened_at
     or new.rescinded_at  is distinct from old.rescinded_at
     or new.cycle_id      is distinct from old.cycle_id
     or new.researcher_id is distinct from old.researcher_id
     or new.project_id    is distinct from old.project_id
     or new.type          is distinct from old.type
     or new.late_submission_allowed is distinct from old.late_submission_allowed  -- (added)
  then
    raise exception 'You are not allowed to change that field on a proposal'
      using errcode = '42501';
  end if;

  return new;
end;
$$;

-- ----------------------------------------------------------------------------
-- 4. Amend submit_proposal: enforce stage + deadline.
--
--    Existing checks kept intact: ownership, draft/reopened state.
--    New checks (skipped entirely for type 'off_cycle', and skipped when the
--    manager has set late_submission_allowed = true):
--      (a) STAGE  -- the cycle's status must accept this proposal type:
--            pre                  -> 'pre_proposal_open'
--            full / continuation  -> 'full_proposal_open'
--      (b) DEADLINE -- the stage's deadline date must not have passed:
--            pre                  -> cycles.pre_proposal_closes_at
--            full / continuation  -> cycles.full_proposal_due_at
--          A null deadline means "no deadline" and never blocks.
-- ----------------------------------------------------------------------------
create or replace function public.submit_proposal(p_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_owner       uuid;
  v_state       text;
  v_type        text;
  v_late        boolean;
  v_cstatus     text;
  v_pre_close   date;
  v_full_due    date;
  v_deadline    date;
  v_stage_phrase text;
begin
  -- Pull proposal + its cycle in one shot; lock the proposal row.
  select p.researcher_id, p.state, p.type, p.late_submission_allowed,
         c.status, c.pre_proposal_closes_at, c.full_proposal_due_at
    into v_owner, v_state, v_type, v_late,
         v_cstatus, v_pre_close, v_full_due
  from public.proposals p
  join public.cycles c on c.id = p.cycle_id
  where p.id = p_id
  for update of p;

  if v_owner is null then
    raise exception 'Proposal not found' using errcode = 'P0002';
  end if;
  if v_owner <> auth.uid() then
    raise exception 'You can only submit your own proposal' using errcode = '42501';
  end if;
  if v_state not in ('draft', 'reopened') then
    raise exception 'Only a draft or reopened proposal can be submitted' using errcode = '42501';
  end if;

  -- Stage + deadline enforcement. Off-cycle proposals are invited outside the
  -- normal cycle by design and are exempt. A manager override skips both checks.
  if v_type <> 'off_cycle' and not coalesce(v_late, false) then

    -- Human-readable phrase for the current cycle stage, for the error message.
    v_stage_phrase := case v_cstatus
      when 'setup'              then 'it is still in setup'
      when 'pre_proposal_open'  then 'it is in the pre-proposal stage'
      when 'pre_review'         then 'it is in pre-proposal review'
      when 'advance_decision'   then 'it is in the advancement-decision stage'
      when 'full_proposal_open' then 'it is in the full-proposal stage'
      when 'full_review'        then 'it is in full-proposal review'
      when 'deliberation'       then 'it is in deliberation'
      when 'funding_decisions'  then 'it is in funding decisions'
      when 'closed'             then 'it is closed'
      else 'it is in the ' || v_cstatus || ' stage'
    end;

    -- (a) STAGE: cycle status must accept this type.
    if v_type = 'pre' then
      if v_cstatus <> 'pre_proposal_open' then
        raise exception
          'This cycle is not currently accepting pre-proposals (%).', v_stage_phrase
          using errcode = '42501';
      end if;
    elsif v_type in ('full', 'continuation') then
      if v_cstatus <> 'full_proposal_open' then
        raise exception
          'This cycle is not currently accepting full proposals (%).', v_stage_phrase
          using errcode = '42501';
      end if;
    end if;

    -- (b) DEADLINE: the relevant date (if set) must not have passed.
    v_deadline := case when v_type = 'pre' then v_pre_close else v_full_due end;

    -- The deadline DATE is inclusive and means END OF DAY PACIFIC, not UTC
    -- midnight. A submission at 5pm Pacific on the deadline date must succeed.
    -- We build the cutoff as midnight (start) of the day AFTER the deadline,
    -- interpreted in America/Los_Angeles: (date + 1 day) is a plain timestamp
    -- at 00:00; "at time zone 'America/Los_Angeles'" reads that wall-clock as
    -- Pacific and yields a timestamptz. now() >= that cutoff means the whole
    -- Pacific deadline day (incl. its 5pm) has elapsed -> too late. This also
    -- floats correctly across the PST/PDT DST boundary because the offset is
    -- resolved for the cutoff instant, not hardcoded.
    if v_deadline is not null
       and now() >= ((v_deadline + interval '1 day') at time zone 'America/Los_Angeles')
    then
      raise exception
        'The % deadline passed on %. Contact the program manager if you need to submit late.',
        case when v_type = 'pre' then 'pre-proposal' else 'full-proposal' end,
        to_char(v_deadline, 'FMDD FMMonth YYYY')   -- e.g. "30 November 2026"
        using errcode = '42501';
    end if;
  end if;

  perform set_config('app.proposal_rpc', 'on', true);
  update public.proposals
  set state = 'submitted', submitted_at = now()
  where id = p_id;
  perform set_config('app.proposal_rpc', 'off', true);
end;
$$;

-- Grants unchanged (submit_proposal already granted to authenticated), restated
-- for a self-contained apply.
revoke all on function public.submit_proposal(uuid) from public, anon;
grant execute on function public.submit_proposal(uuid) to authenticated;
