-- ============================================================================
-- Migration: committee membership management -- deactivate, reactivate, delete
--
-- Committee members cycle off. Until now the only way to express that was to
-- leave the account fully active or destroy it, and destroying it is impossible
-- for anyone who has ever reviewed (reviews.reviewer_id is ON DELETE RESTRICT,
-- deliberately). This migration adds the missing middle: a former member whose
-- ACCESS is removed and whose REVIEW HISTORY is untouched.
--
-- 1. profiles.status gains 'inactive'.
--
--    'inactive' means: a former committee member. Access removed, history kept.
--    It is NOT 'rejected'. 'rejected' means "we declined your registration" and
--    is what every researcher-facing surface says it means; reusing it would
--    make a retired committee member indistinguishable from a turned-down
--    applicant in any later audit, and would read wrong on the manager's own
--    screens.
--
--    THE REST OF THE SCHEMA NEEDS NO CHANGE. Everything that decides who is an
--    active committee member already gates on status = 'approved':
--      - is_committee(uuid)                      20260720083547
--      - committee_review_progress               20260816140000
--      - committee_member_review_status          20260816140000
--      - manager_dashboard_stats (member count)  20260724093000
--    so all of them treat 'inactive' correctly the moment it exists. The seven
--    committee read policies (20260721090232), the committee cycles policy
--    (20260721102325) and the committee report policies (20260723090000) all go
--    through is_committee, so an inactive member loses every read as well.
--
--    DELIBERATELY NOT CHANGED: proposal_review_summary (20260816140000) does not
--    reference profiles at all -- its counts, total_score and max_possible come
--    only from the review rows. That is what makes deactivation safe: a member
--    who cycles off keeps every submitted score, and no proposal's total,
--    average or denominator moves. Do not "fix" it to filter by status.
--
--    The CHECK is dropped by lookup rather than by name: it was declared inline
--    in create table (20260717102858), so its name is generated and asserting
--    'profiles_status_check' here would silently no-op if it were ever
--    different, leaving the old constraint in force and every write of
--    'inactive' rejected.
--
-- 2. set_committee_member_status(uuid, text) -- the manager's switch.
--
--    An RPC and not an RLS policy, because there is NO manager UPDATE policy on
--    profiles: the only update policy is profiles_update_own (20260717102858).
--    Managers read every row and write only their own. SECURITY DEFINER with an
--    is_manager guard is how approve_researcher / reject_researcher already do
--    this, and this mirrors them.
--
--    It touches status and NOTHING ELSE -- in particular it does not read,
--    write or delete a single row of reviews or review_answers. Deactivation is
--    a change to one person's access, never to the record of what they scored.
--
-- 3/4. An inactive member must not be able to WRITE a review.
--
--    is_committee already blocks creating one (reviews_insert_own) and reading
--    any proposal to review. But two holes remained, found in the read-only
--    investigation that preceded this work:
--      - submit_review and set_review_participation check OWNERSHIP only, so a
--        deactivated member holding a draft review id could still submit it --
--        and proposal_review_summary would then count it, moving the total AND
--        the denominator on a proposal that may already be decided.
--      - reviews_update_own and the three review_answers write policies check
--        ownership only, so a deactivated member could still edit a draft.
--    Both are closed below. The SELECT policies are deliberately left alone:
--    reading one's own old review harms nothing, and the surrounding reads
--    (proposals, cycles, questions) are gated by is_committee anyway.
--
-- Reuses existing functions: public.is_manager(uuid), public.is_committee(uuid),
--   public.owns_review(uuid, uuid), public.proposal_visible_to_committee(uuid).
-- Does NOT redefine them.
--
-- NO BACKFILL: every existing member stays 'approved', which is what they are.
--
-- NOTE: apply by pasting into the Supabase dashboard SQL editor.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. profiles.status gains 'inactive'
-- ----------------------------------------------------------------------------
do $$
declare
  v_name text;
begin
  -- Drop whatever the status CHECK is actually called (see header).
  for v_name in
    select con.conname
    from pg_constraint con
    join pg_class rel on rel.oid = con.conrelid
    join pg_namespace nsp on nsp.oid = rel.relnamespace
    where nsp.nspname = 'public'
      and rel.relname = 'profiles'
      and con.contype = 'c'
      and pg_get_constraintdef(con.oid) ilike '%status%'
      and pg_get_constraintdef(con.oid) ilike '%rejected%'
  loop
    execute format('alter table public.profiles drop constraint %I', v_name);
  end loop;
end;
$$;

alter table public.profiles
  add constraint profiles_status_check
  check (status in ('pending', 'approved', 'rejected', 'inactive'));

comment on column public.profiles.status is
  'pending / approved / rejected are the researcher registration states. '
  'inactive is a FORMER COMMITTEE MEMBER: access removed, review history kept. '
  'Only set_committee_member_status writes ''inactive''.';

-- ----------------------------------------------------------------------------
-- 2. set_committee_member_status -- manager-only, status only
-- ----------------------------------------------------------------------------
create or replace function public.set_committee_member_status(
  p_target uuid,
  p_status text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_role text;
begin
  if not public.is_manager(auth.uid()) then
    raise exception 'Only a manager may change a committee member''s status'
      using errcode = '42501';
  end if;

  -- Only the two committee states. 'pending' and 'rejected' are registration
  -- states and must not be reachable from the committee screen.
  if p_status not in ('approved', 'inactive') then
    raise exception
      'A committee member''s status must be ''approved'' or ''inactive'' (got %).',
      p_status
      using errcode = '22023';  -- invalid_parameter_value
  end if;

  select role into v_role
  from public.profiles
  where id = p_target
  for update;

  if v_role is null then
    raise exception 'Profile not found' using errcode = 'P0002';
  end if;
  if v_role <> 'committee' then
    raise exception
      'Only a committee member''s status can be changed here (this profile is a %).',
      v_role
      using errcode = '42501';
  end if;

  -- Status only. No review row is read or written here, by design: a member's
  -- submitted scores outlive their access. prevent_profile_self_elevation
  -- permits this because the caller is a manager.
  update public.profiles
  set status = p_status
  where id = p_target;
end;
$$;

comment on function public.set_committee_member_status(uuid, text) is
  'Manager-only. Sets a committee member''s status to approved (reactivate) or '
  'inactive (deactivate). Never touches reviews or review_answers.';

revoke all on function public.set_committee_member_status(uuid, text) from public, anon;
grant execute on function public.set_committee_member_status(uuid, text) to authenticated;

-- ----------------------------------------------------------------------------
-- 3. submit_review -- RESTATED from 20260816140000 section 4.
--    ONE addition: an active-committee gate ahead of everything else. Every
--    other check, message, errcode and the app.review_rpc bypass are unchanged.
--    The gate goes FIRST so an inactive member gets a message about their
--    access rather than a confusing one about ownership.
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
  if not public.is_committee(auth.uid()) then
    raise exception
      'Your committee access has ended. Contact the program manager.'
      using errcode = '42501';
  end if;

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
-- 4. set_review_participation -- RESTATED from 20260816140000 section 3.
--    ONE addition: the same active-committee gate, in the same place. The
--    parameter validation, ownership check, submitted-lock, the note about
--    keeping answers, and the app.review_rpc bypass are unchanged.
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
  if not public.is_committee(auth.uid()) then
    raise exception
      'Your committee access has ended. Contact the program manager.'
      using errcode = '42501';
  end if;

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
-- 5. Review write policies -- RESTATED from 20260721091640 section 7.
--    Every WRITE now requires an active committee member, so an inactive member
--    cannot edit even their own draft.
--
--    reviews_insert_own already required is_committee and is restated unchanged,
--    so the whole write surface can be read in one place.
--
--    The SELECT policies (reviews_select_own, review_answers_select_own) are
--    deliberately NOT restated: reading one's own past review is harmless, and
--    everything around it -- the proposal, the cycle, the questions -- is gated
--    by is_committee already.
--
--    reviews still has NO delete policy and no delete grant: reviews are never
--    deleted. review_answers keeps its delete policy (a reviewer clearing an
--    answer on their own open draft), now gated the same way.
-- ----------------------------------------------------------------------------

-- reviews --------------------------------------------------------------------
drop policy if exists "reviews_insert_own" on public.reviews;
create policy "reviews_insert_own"
  on public.reviews for insert to authenticated
  with check (
    reviewer_id = auth.uid()
    and public.is_committee(auth.uid())
    and public.proposal_visible_to_committee(proposal_id)
  );

drop policy if exists "reviews_update_own" on public.reviews;
create policy "reviews_update_own"
  on public.reviews for update to authenticated
  using (reviewer_id = auth.uid() and public.is_committee(auth.uid()))
  with check (reviewer_id = auth.uid() and public.is_committee(auth.uid()));

-- review_answers -------------------------------------------------------------
drop policy if exists "review_answers_insert_own" on public.review_answers;
create policy "review_answers_insert_own"
  on public.review_answers for insert to authenticated
  with check (
    public.owns_review(review_id, auth.uid())
    and public.is_committee(auth.uid())
  );

drop policy if exists "review_answers_update_own" on public.review_answers;
create policy "review_answers_update_own"
  on public.review_answers for update to authenticated
  using (
    public.owns_review(review_id, auth.uid())
    and public.is_committee(auth.uid())
  )
  with check (
    public.owns_review(review_id, auth.uid())
    and public.is_committee(auth.uid())
  );

drop policy if exists "review_answers_delete_own" on public.review_answers;
create policy "review_answers_delete_own"
  on public.review_answers for delete to authenticated
  using (
    public.owns_review(review_id, auth.uid())
    and public.is_committee(auth.uid())
  );

-- ----------------------------------------------------------------------------
-- 6. list_committee_members -- RESTATED. The committee screen now needs the
--    member's status, when they last signed in, and how much they have
--    reviewed (to decide whether a hard delete is even offered).
--
--    The return shape grows, so the old function is dropped first.
--
--    An RPC rather than a service-role read in the page: it already exists for
--    exactly this screen and already joins auth.users for the address, so
--    last_sign_in_at is the same join; and the is_manager check stays in the
--    database instead of depending on the page remembering to guard before
--    reaching for a client that bypasses RLS entirely.
--
--    Still NOT filtered by status -- an inactive member must stay listed, or
--    the manager could never reactivate them.
--
--    reviews_total counts EVERY review row in any state, because that is what
--    the ON DELETE RESTRICT on reviews.reviewer_id actually blocks a delete on.
--    reviews_submitted is the number worth showing a human.
-- ----------------------------------------------------------------------------
drop function if exists public.list_committee_members();

create or replace function public.list_committee_members()
returns table (
  id                   uuid,
  full_name            text,
  email                text,
  status               text,
  invited_at           timestamptz,
  last_sign_in_at      timestamptz,
  must_change_password boolean,
  reviews_total        int,
  reviews_submitted    int
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not public.is_manager(auth.uid()) then
    raise exception 'Only a manager may list committee members'
      using errcode = '42501';
  end if;

  return query
    select
      p.id,
      p.full_name,
      u.email::text,
      p.status,
      p.invited_at,
      u.last_sign_in_at,
      p.must_change_password,
      agg.total::int,
      agg.submitted::int
    from public.profiles p
    join auth.users u on u.id = p.id
    cross join lateral (
      select
        count(*)                                        as total,
        count(*) filter (where rv.state = 'submitted')  as submitted
      from public.reviews rv
      where rv.reviewer_id = p.id
    ) agg
    where p.role = 'committee'
    order by p.invited_at desc nulls last, p.created_at desc;
end;
$$;

revoke all on function public.list_committee_members() from public, anon;
grant execute on function public.list_committee_members() to authenticated;
