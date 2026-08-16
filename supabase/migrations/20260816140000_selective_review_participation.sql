-- ============================================================================
-- Migration: selective review participation (opt in / decline per proposal)
--
-- A committee member's first action on a proposal is a gate: "Will you review
-- this?" A member who declines is fully EXCLUDED from that proposal -- they
-- don't score it and they drop out of BOTH the total score AND the max-possible.
-- So max-possible becomes a PER-PROPOSAL figure driven by who opted in:
--   10 members, one 5-point question => 50 possible; if 2 decline => 40.
-- A declined member may switch back to reviewing until they submit (or, in the
-- UI, until the deadline). There is no minimum number of reviewers.
--
-- Reuses existing functions: public.is_manager(uuid), public.is_committee(uuid),
--   public.proposal_visible_to_committee(uuid). Does NOT redefine them.
--
-- NOTE: apply by pasting into the Supabase dashboard SQL editor.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. reviews.participation -- the gate answer. A review row can exist before the
--    member has answered, so 'undecided' is explicit (not inferred from state).
-- ----------------------------------------------------------------------------
alter table public.reviews
  add column if not exists participation text not null default 'undecided'
    check (participation in ('undecided', 'reviewing', 'declined'));

comment on column public.reviews.participation is
  'The committee member''s opt-in gate for this proposal: undecided (default, '
  'not answered), reviewing (opted in -- scores count), or declined (opted out '
  '-- excluded from total AND max-possible). Set only via set_review_participation.';

-- ----------------------------------------------------------------------------
-- 2. reviews owner-guard -- RESTATED in full.
--    Change vs the reviews data layer: participation is now RPC-only. A fresh
--    reviewer INSERT must start 'undecided' (added to the clean-draft check), and
--    participation is added to the reviewer-UPDATE protected list, so it moves
--    ONLY through set_review_participation (which bypasses via app.review_rpc).
--    Everything else -- the auth.uid() null admin path, the stage-vs-proposal
--    consistency check, the app.review_rpc bypass, the manager bypass, the
--    submitted-lock, and the other protected fields -- is unchanged.
-- ----------------------------------------------------------------------------
create or replace function public.enforce_review_owner_rules()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_type        text;
  v_expected    text;
  v_check_stage boolean := false;
begin
  -- Admin (dashboard, auth.uid() null): fully unrestricted so data can be fixed
  -- by hand, including a deliberately mismatched stage.
  if auth.uid() is null then
    return new;
  end if;

  -- Stage-vs-proposal consistency applies to managers AND reviewers (a
  -- mismatched stage is invalid data regardless of writer). The RPCs never
  -- change stage, so skip on their bypass path; on UPDATE only re-check if the
  -- stage actually moved. Branch on TG_OP so OLD is never touched on INSERT.
  if current_setting('app.review_rpc', true) <> 'on' then
    if tg_op = 'INSERT' then
      v_check_stage := true;
    elsif new.stage is distinct from old.stage then
      v_check_stage := true;
    end if;
  end if;

  if v_check_stage then
    select p.type into v_type
    from public.proposals p
    where p.id = new.proposal_id;
    -- If the proposal is missing the FK will reject it; only enforce when found.
    if v_type is not null then
      v_expected := case when v_type = 'pre' then 'pre' else 'full' end;
      if new.stage <> v_expected then
        raise exception
          'Review stage (%) does not match the proposal type % (expected stage %)',
          new.stage, v_type, v_expected
          using errcode = '42501';
      end if;
    end if;
  end if;

  -- Sanctioned RPC path: bypass the ownership rules below.
  if current_setting('app.review_rpc', true) = 'on' then
    return new;
  end if;

  -- Manager: bypass the ownership rules (stage already validated above).
  if public.is_manager(auth.uid()) then
    return new;
  end if;

  -- Reviewer INSERT: a new review must be your own clean, undecided draft.
  if tg_op = 'INSERT' then
    if new.state <> 'draft'
       or new.submitted_at is not null
       or new.reopened_at is not null
       or new.participation <> 'undecided'
       or new.reviewer_id <> auth.uid()
    then
      raise exception 'A new review must start as your own clean draft'
        using errcode = '42501';
    end if;
    return new;
  end if;

  -- Reviewer UPDATE:
  -- (a) a submitted review is locked entirely.
  if old.state not in ('draft', 'reopened') then
    raise exception 'This review is locked and can no longer be edited'
      using errcode = '42501';
  end if;

  -- (b) these fields move only via the RPCs or a manager. participation is
  -- RPC-only (set_review_participation) so it's protected here.
  if new.state         is distinct from old.state
     or new.submitted_at  is distinct from old.submitted_at
     or new.reopened_at   is distinct from old.reopened_at
     or new.participation is distinct from old.participation
     or new.proposal_id   is distinct from old.proposal_id
     or new.reviewer_id   is distinct from old.reviewer_id
     or new.stage         is distinct from old.stage
  then
    raise exception 'You are not allowed to change that field on a review'
      using errcode = '42501';
  end if;

  return new;
end;
$$;

-- Trigger definition unchanged; restated for a self-contained apply.
drop trigger if exists trg_reviews_owner_rules on public.reviews;
create trigger trg_reviews_owner_rules
  before insert or update on public.reviews
  for each row
  execute function public.enforce_review_owner_rules();

-- ----------------------------------------------------------------------------
-- 3. set_review_participation(review_id, participation) -- the owning member
--    answers (or changes) the gate. RPC-only field; bypasses the owner guard
--    via app.review_rpc, exactly as submit_review / reopen_review do.
-- ----------------------------------------------------------------------------
create or replace function public.set_review_participation(
  p_review_id uuid,
  p_participation text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_owner uuid;
  v_state text;
begin
  -- 'undecided' is the default only; the gate answer must be an explicit choice.
  if p_participation not in ('reviewing', 'declined') then
    raise exception
      'Participation must be ''reviewing'' or ''declined'''
      using errcode = '22023';  -- invalid_parameter_value
  end if;

  select reviewer_id, state into v_owner, v_state
  from public.reviews
  where id = p_review_id
  for update;

  if v_owner is null then
    raise exception 'Review not found' using errcode = 'P0002';
  end if;
  if v_owner <> auth.uid() then
    raise exception 'You can only set participation on your own review'
      using errcode = '42501';
  end if;
  -- Locked once submitted -- switching in/out requires a manager reopen. A
  -- 'declined' review is never 'submitted', so this only blocks a submitted
  -- 'reviewing' review from being changed.
  if v_state not in ('draft', 'reopened') then
    raise exception
      'This review is submitted. Ask the program manager to reopen it before changing whether you will review this proposal.'
      using errcode = '42501';
  end if;

  -- Declining with existing answers is fine (they simply stop counting);
  -- switching back to reviewing re-includes them. We never delete answers here.
  perform set_config('app.review_rpc', 'on', true);
  update public.reviews
  set participation = p_participation
  where id = p_review_id;
  perform set_config('app.review_rpc', 'off', true);
end;
$$;

revoke all on function public.set_review_participation(uuid, text) from public, anon;
grant execute on function public.set_review_participation(uuid, text) to authenticated;

-- ----------------------------------------------------------------------------
-- 4. submit_review -- RESTATED in full. Preserved: not-found (P0002), ownership,
--    draft/reopened-state requirement, the "all active questions scored" check,
--    and the app.review_rpc bypass around the state write. Added: you may submit
--    only if participation='reviewing'. A declined (or still-undecided) review
--    has nothing to submit and raises a clear message.
-- ----------------------------------------------------------------------------
create or replace function public.submit_review(r_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_owner         uuid;
  v_state         text;
  v_proposal      uuid;
  v_stage         text;
  v_participation text;
  v_cycle         uuid;
  v_unanswered    int;
begin
  select reviewer_id, state, proposal_id, stage, participation
    into v_owner, v_state, v_proposal, v_stage, v_participation
  from public.reviews
  where id = r_id
  for update;

  if v_owner is null then
    raise exception 'Review not found' using errcode = 'P0002';
  end if;
  if v_owner <> auth.uid() then
    raise exception 'You can only submit your own review' using errcode = '42501';
  end if;
  if v_state not in ('draft', 'reopened') then
    raise exception 'Only a draft or reopened review can be submitted' using errcode = '42501';
  end if;

  -- Participation gate: only an opted-in review is submittable.
  if v_participation <> 'reviewing' then
    raise exception
      'Choose to review this proposal before submitting. You have either not answered whether you will review it, or you declined -- a declined proposal has nothing to submit.'
      using errcode = '42501';
  end if;

  select cycle_id into v_cycle from public.proposals where id = v_proposal;

  select count(*) into v_unanswered
  from public.review_questions q
  where q.cycle_id = v_cycle
    and q.stage = v_stage
    and q.is_active = true
    and not exists (
      select 1
      from public.review_answers a
      where a.review_id = r_id
        and a.question_id = q.id
        and a.score is not null
    );

  if v_unanswered > 0 then
    raise exception
      'Score all questions before submitting (% still unanswered)', v_unanswered
      using errcode = '42501';
  end if;

  perform set_config('app.review_rpc', 'on', true);
  update public.reviews
  set state = 'submitted', submitted_at = now()
  where id = r_id;
  perform set_config('app.review_rpc', 'off', true);
end;
$$;

revoke all on function public.submit_review(uuid) from public, anon;
grant execute on function public.submit_review(uuid) to authenticated;

-- ----------------------------------------------------------------------------
-- 5. proposal_review_summary(cycle) -- RESTATED, participation-aware. The return
--    shape grows (declined_count), so the old version is dropped first.
--
--    Per proposal, counting ONLY opted-in ('reviewing') reviews for scores:
--      reviews_submitted   = state='submitted' AND participation='reviewing'
--      reviews_in_progress = participation='reviewing' AND state in draft/reopened
--      declined_count      = participation='declined'   (NEW)
--      total_score         = sum of scores over submitted reviewing reviews
--      max_possible        = (sum of score_max for the stage's active questions)
--                            × (# submitted reviewing reviews)
--      average_score       = total_score / reviews_submitted (null if 0), 2dp
--
--    50->40 example: one 5-point question => stage max_sum = 5. If 8 of 10
--    members opted in and submitted, max_possible = 5 × 8 = 40; the 2 who
--    declined are neither counted nor part of the denominator.
-- ----------------------------------------------------------------------------
drop function if exists public.proposal_review_summary(uuid);

create or replace function public.proposal_review_summary(p_cycle_id uuid)
returns table (
  proposal_id         uuid,
  reviews_submitted   int,
  reviews_in_progress int,
  declined_count      int,
  total_score         numeric,
  average_score       numeric,
  max_possible        numeric
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not public.is_manager(auth.uid()) then
    raise exception 'Only a manager may view review summaries'
      using errcode = '42501';
  end if;

  return query
  with stage_max as (
    -- sum of score_max per stage for the active questions of this cycle
    select q.stage, sum(q.score_max)::numeric as max_sum
    from public.review_questions q
    where q.cycle_id = p_cycle_id
      and q.is_active = true
    group by q.stage
  )
  select
    p.id as proposal_id,
    coalesce(rc.submitted_count, 0)::int    as reviews_submitted,
    coalesce(rc.in_progress_count, 0)::int  as reviews_in_progress,
    coalesce(rc.declined_count, 0)::int     as declined_count,
    coalesce(sc.total_score, 0)::numeric    as total_score,
    case
      when coalesce(rc.submitted_count, 0) > 0
        then round(coalesce(sc.total_score, 0) / rc.submitted_count, 2)
      else null
    end                                     as average_score,
    (coalesce(sm.max_sum, 0) * coalesce(rc.submitted_count, 0))::numeric
                                            as max_possible
  from public.proposals p
  -- review counts by state, restricted to opted-in reviewers for scoring counts
  left join lateral (
    select
      count(*) filter (
        where r.state = 'submitted' and r.participation = 'reviewing'
      )                                                        as submitted_count,
      count(*) filter (
        where r.participation = 'reviewing'
          and r.state in ('draft', 'reopened')
      )                                                        as in_progress_count,
      count(*) filter (where r.participation = 'declined')     as declined_count
    from public.reviews r
    where r.proposal_id = p.id
  ) rc on true
  -- summed scores across SUBMITTED, opted-in reviews only
  left join lateral (
    select sum(a.score)::numeric as total_score
    from public.reviews r
    join public.review_answers a on a.review_id = r.id
    where r.proposal_id = p.id
      and r.state = 'submitted'
      and r.participation = 'reviewing'
  ) sc on true
  -- stage-appropriate max: pre-proposals use 'pre'; everything else 'full'
  left join stage_max sm
    on sm.stage = case when p.type = 'pre' then 'pre' else 'full' end
  where p.cycle_id = p_cycle_id;
end;
$$;

revoke all on function public.proposal_review_summary(uuid) from public, anon;
grant execute on function public.proposal_review_summary(uuid) to authenticated;

-- ----------------------------------------------------------------------------
-- 6a. committee_review_progress -- RESTATED, participation-aware.
--     expected  = opted-in reviews (participation='reviewing') by approved
--                 committee on open-cycle submitted proposals.
--     submitted = of those, state='submitted'.
--     outstanding = expected - submitted.
--     A declined review is neither expected nor outstanding (the member opted
--     out). Return shape unchanged.
-- ----------------------------------------------------------------------------
create or replace function public.committee_review_progress()
returns table (
  expected_reviews    int,
  submitted_reviews   int,
  outstanding_reviews int
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_expected  int;
  v_submitted int;
begin
  if not public.is_manager(auth.uid()) then
    raise exception 'Only a manager may view review progress' using errcode = '42501';
  end if;

  select count(*) into v_expected
  from public.reviews rv
  join public.proposals pr on pr.id = rv.proposal_id
  join public.cycles c on c.id = pr.cycle_id
  join public.profiles pm on pm.id = rv.reviewer_id
  where c.status not in ('setup', 'closed')
    and pr.state = 'submitted'
    and rv.participation = 'reviewing'
    and pm.role = 'committee'
    and pm.status = 'approved';

  select count(*) into v_submitted
  from public.reviews rv
  join public.proposals pr on pr.id = rv.proposal_id
  join public.cycles c on c.id = pr.cycle_id
  join public.profiles pm on pm.id = rv.reviewer_id
  where c.status not in ('setup', 'closed')
    and pr.state = 'submitted'
    and rv.participation = 'reviewing'
    and rv.state = 'submitted'
    and pm.role = 'committee'
    and pm.status = 'approved';

  return query
  select v_expected, v_submitted, greatest(v_expected - v_submitted, 0);
end;
$$;

revoke all on function public.committee_review_progress() from public, anon;
grant execute on function public.committee_review_progress() to authenticated;

-- ----------------------------------------------------------------------------
-- 6b. committee_member_review_status -- RESTATED, participation-aware.
--     Per member: assigned_count = proposals they OPTED INTO ('reviewing') on
--     open-cycle submitted proposals; submitted_count = of those, submitted;
--     outstanding = difference. Declined proposals don't count against them.
--     assigned_count is therefore per-member (no longer a uniform total). Return
--     shape unchanged.
-- ----------------------------------------------------------------------------
create or replace function public.committee_member_review_status()
returns table (
  reviewer_id       uuid,
  reviewer_name     text,
  assigned_count    int,
  submitted_count   int,
  outstanding_count int
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not public.is_manager(auth.uid()) then
    raise exception 'Only a manager may view committee review status'
      using errcode = '42501';
  end if;

  return query
  select
    p.id,
    p.full_name,
    agg.assigned_count::int,
    agg.submitted_count::int,
    greatest(agg.assigned_count - agg.submitted_count, 0)::int
  from public.profiles p
  cross join lateral (
    select
      count(*) filter (where rv.participation = 'reviewing') as assigned_count,
      count(*) filter (
        where rv.participation = 'reviewing' and rv.state = 'submitted'
      ) as submitted_count
    from public.reviews rv
    join public.proposals pr on pr.id = rv.proposal_id
    join public.cycles c on c.id = pr.cycle_id
    where c.status not in ('setup', 'closed')
      and pr.state = 'submitted'
      and rv.reviewer_id = p.id
  ) agg
  where p.role = 'committee' and p.status = 'approved'
  order by greatest(agg.assigned_count - agg.submitted_count, 0) desc;
end;
$$;

revoke all on function public.committee_member_review_status() from public, anon;
grant execute on function public.committee_member_review_status() to authenticated;

-- ----------------------------------------------------------------------------
-- 6c. committee_dashboard -- RESTATED, participation-aware (member's own view).
--     Semantics chosen:
--       proposals_to_review    = submitted proposals in the cycle the member has
--                                NOT declined (i.e. still needs attention:
--                                undecided / not-yet-opened, or opted-in).
--       my_reviews_submitted   = the member's submitted 'reviewing' reviews.
--       my_reviews_outstanding = proposals_to_review - my_reviews_submitted
--                                (undecided + opted-in-but-not-submitted).
--     A proposal the member declined is NOT "to review" and never counts as
--     outstanding. Cycles are still listed when they have any submitted proposal
--     (total_submitted > 0), so a member who declined everything still sees the
--     cycle with 0 to review. Return shape unchanged.
-- ----------------------------------------------------------------------------
create or replace function public.committee_dashboard()
returns table (
  cycle_id               uuid,
  name                   text,
  status                 text,
  review_deadline        date,
  review_deadline_label  text,
  proposals_to_review    int,
  my_reviews_submitted   int,
  my_reviews_outstanding int
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
begin
  if not public.is_committee(v_uid) then
    raise exception 'Only a committee member may view the committee dashboard'
      using errcode = '42501';
  end if;

  return query
  with cyc as (
    select
      c.id,
      c.name,
      c.status,
      c.pre_review_due_at,
      c.full_review_due_at,
      (select count(*) from public.proposals pr
         where pr.cycle_id = c.id and pr.state = 'submitted')::int
        as total_submitted,
      (select count(*) from public.reviews rv
         join public.proposals pr on pr.id = rv.proposal_id
        where pr.cycle_id = c.id
          and pr.state = 'submitted'
          and rv.reviewer_id = v_uid
          and rv.participation = 'declined')::int
        as declined_by_me,
      (select count(*) from public.reviews rv
         join public.proposals pr on pr.id = rv.proposal_id
        where pr.cycle_id = c.id
          and pr.state = 'submitted'
          and rv.reviewer_id = v_uid
          and rv.participation = 'reviewing'
          and rv.state = 'submitted')::int
        as mine
    from public.cycles c
    where c.status not in ('setup', 'closed')
  )
  select
    cyc.id,
    cyc.name,
    cyc.status,
    case cyc.status
      when 'pre_review'         then cyc.pre_review_due_at
      when 'full_review'        then cyc.full_review_due_at
      when 'full_proposal_open' then cyc.full_review_due_at
      else coalesce(cyc.pre_review_due_at, cyc.full_review_due_at)
    end as review_deadline,
    case cyc.status
      when 'pre_review'         then 'Pre-reviews due'
      when 'full_review'        then 'Full reviews due'
      when 'full_proposal_open' then 'Full reviews due'
      else 'Reviews due'
    end as review_deadline_label,
    greatest(cyc.total_submitted - cyc.declined_by_me, 0)::int
      as proposals_to_review,
    cyc.mine as my_reviews_submitted,
    greatest((cyc.total_submitted - cyc.declined_by_me) - cyc.mine, 0)::int
      as my_reviews_outstanding
  from cyc
  where cyc.total_submitted > 0
  order by review_deadline nulls last;
end;
$$;

revoke all on function public.committee_dashboard() from public, anon;
grant execute on function public.committee_dashboard() to authenticated;
