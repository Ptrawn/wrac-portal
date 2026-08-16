-- ============================================================================
-- Migration: cycle fiscal year + proposal serial numbers
--
-- Cycles carry a manager-chosen FISCAL YEAR (not derived from calendar dates).
-- Every proposal gets a SERIAL NUMBER assigned AT SUBMISSION: "FY-NNN" where FY
-- is the two-digit fiscal year of its cycle and NNN is a zero-padded sequence,
-- in submission order, per fiscal year (e.g. 27-001, 27-002). A funded proposal
-- displays with an "F" suffix (27-001F) -- but the F is a DISPLAY concern based
-- on outcome='funded', NOT stored, so it stays correct if the outcome changes.
--
-- Assignment is atomic (transaction advisory lock keyed on the fiscal year) so
-- concurrent submissions can't collide on the same sequence.
--
-- Reuses existing functions: public.is_manager(uuid), public.set_updated_at().
-- Does NOT redefine them. Amends submit_proposal, preserving every prior check.
--
-- NOTE: apply by pasting into the Supabase dashboard SQL editor.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. cycles.fiscal_year — the manager sets this explicitly per cycle.
-- ----------------------------------------------------------------------------
alter table public.cycles
  add column if not exists fiscal_year int;

comment on column public.cycles.fiscal_year is
  'Fiscal year the cycle funds (e.g. 2027), chosen explicitly by the manager -- '
  'NOT derived from the calendar dates. Nullable so existing cycles do not break, '
  'but a cycle must have it set before its proposals can be submitted (serials '
  'are numbered per fiscal year).';

-- ----------------------------------------------------------------------------
-- 2. proposals.serial_seq / serial_number — assigned at submission.
-- ----------------------------------------------------------------------------
alter table public.proposals
  add column if not exists serial_seq int;
alter table public.proposals
  add column if not exists serial_number text;

comment on column public.proposals.serial_seq is
  'Numeric sequence within the cycle''s fiscal year (1, 2, 3 ...), assigned '
  'atomically at first submission, in submission order. Null until submitted; '
  'never reassigned on resubmission after a reopen.';

comment on column public.proposals.serial_number is
  'Formatted display code WITHOUT the funded suffix, e.g. "27-001" '
  '(right(fiscal_year,2) || "-" || lpad(serial_seq,3,"0")). The "F" suffix for '
  'funded proposals is a DISPLAY concern derived from outcome=''funded'' and is '
  'NOT stored here, so the base code stays stable if the outcome changes. '
  'Compute the display value as serial_number || (case when outcome=''funded'' '
  'then ''F'' else '''' end).';

-- ----------------------------------------------------------------------------
-- 3. submit_proposal — RESTATED in full. Unchanged behaviour (ownership, state,
--    stage/deadline enforcement, late override) PLUS atomic serial assignment.
-- ----------------------------------------------------------------------------
create or replace function public.submit_proposal(p_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_owner        uuid;
  v_state        text;
  v_type         text;
  v_late         boolean;
  v_cstatus      text;
  v_pre_close    date;
  v_full_due     date;
  v_deadline     date;
  v_stage_phrase text;
  v_fiscal_year  int;
  v_serial_seq   int;
  v_new_seq      int;
  v_new_serial   text;
begin
  -- Pull proposal + its cycle in one shot; lock the proposal row.
  select p.researcher_id, p.state, p.type, p.late_submission_allowed,
         c.status, c.pre_proposal_closes_at, c.full_proposal_due_at,
         c.fiscal_year, p.serial_seq
    into v_owner, v_state, v_type, v_late,
         v_cstatus, v_pre_close, v_full_due,
         v_fiscal_year, v_serial_seq
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

  -- Serial numbers are numbered per fiscal year; a first submission needs one.
  if v_serial_seq is null and v_fiscal_year is null then
    raise exception
      'Set the cycle''s fiscal year before proposals can be submitted.'
      using errcode = '42501';
  end if;

  perform set_config('app.proposal_rpc', 'on', true);

  if v_serial_seq is null then
    -- Atomic assignment: serialize concurrent submissions in the same fiscal
    -- year on a transaction-scoped advisory lock, so two submits can't read the
    -- same max() and collide on a sequence number. Held until this txn commits.
    perform pg_advisory_xact_lock(hashtext('proposal_serial:' || v_fiscal_year::text));

    select coalesce(max(p.serial_seq), 0) + 1
      into v_new_seq
    from public.proposals p
    join public.cycles c on c.id = p.cycle_id
    where c.fiscal_year = v_fiscal_year;

    -- e.g. fiscal_year 2027, seq 1 -> "27-001"
    v_new_serial := right(v_fiscal_year::text, 2) || '-' || lpad(v_new_seq::text, 3, '0');

    update public.proposals
    set state = 'submitted',
        submitted_at = now(),
        serial_seq = v_new_seq,
        serial_number = v_new_serial
    where id = p_id;
  else
    -- Resubmission after a reopen: keep the original serial.
    update public.proposals
    set state = 'submitted',
        submitted_at = now()
    where id = p_id;
  end if;

  perform set_config('app.proposal_rpc', 'off', true);
end;
$$;

-- Grants unchanged (submit_proposal already granted to authenticated), restated
-- for a self-contained apply.
revoke all on function public.submit_proposal(uuid) from public, anon;
grant execute on function public.submit_proposal(uuid) to authenticated;

-- ----------------------------------------------------------------------------
-- 4. Display serial (base code + "F" when funded).
--    PREFERRED: the app computes this from the two columns it already reads,
--    which keeps it RLS-safe (no SECURITY DEFINER bypass) and needs no round
--    trip -- so NO function is added. Compute it in the app as:
--
--        serial_number
--          ? serial_number + (outcome === 'funded' ? 'F' : '')
--          : null
--
--    or in SQL where a proposal row is already visible to the caller:
--
--        serial_number || case when outcome = 'funded' then 'F' else '' end
--
--    (A SECURITY DEFINER helper was intentionally NOT created: it would read a
--    proposal by id bypassing RLS and could leak serials across the role
--    boundary, for no benefit over the expression above.)
-- ----------------------------------------------------------------------------
