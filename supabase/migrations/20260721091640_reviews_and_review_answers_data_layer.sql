-- ============================================================================
-- Migration: committee reviews (scores + comments) data layer
-- Every committee member reviews every proposal in a stage. Reviews are SILOED
-- -- a member never sees another member's review; only the Manager sees all.
-- A review is draft -> submitted (locked), and the Manager can reopen it.
--
-- Reuses existing functions: public.is_manager(uuid), public.is_committee(uuid),
--   public.proposal_visible_to_committee(uuid), public.set_updated_at().
-- Adds: review_is_editable, owns_review, and guard/RPC functions.
--
-- NOTE: apply by pasting into the Supabase dashboard SQL editor.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. reviews table -- one review per reviewer per proposal
-- ----------------------------------------------------------------------------
create table if not exists public.reviews (
  id           uuid primary key default gen_random_uuid(),
  proposal_id  uuid not null references public.proposals (id) on delete cascade,
  reviewer_id  uuid not null references public.profiles (id) on delete restrict,
  stage        text not null check (stage in ('pre', 'full')),
  state        text not null default 'draft'
                 check (state in ('draft', 'submitted', 'reopened')),
  submitted_at timestamptz,
  reopened_at  timestamptz,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  unique (proposal_id, reviewer_id)
);

create index if not exists reviews_proposal_idx on public.reviews (proposal_id);
create index if not exists reviews_reviewer_idx on public.reviews (reviewer_id);

-- ----------------------------------------------------------------------------
-- 2. review_answers table -- one answer per question per review
-- ----------------------------------------------------------------------------
create table if not exists public.review_answers (
  id          uuid primary key default gen_random_uuid(),
  review_id   uuid not null references public.reviews (id) on delete cascade,
  question_id uuid not null references public.review_questions (id) on delete restrict,
  score       int,
  comment     text,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  unique (review_id, question_id)
);

create index if not exists review_answers_review_idx on public.review_answers (review_id);

-- ----------------------------------------------------------------------------
-- 3. updated_at triggers (reuse existing public.set_updated_at())
-- ----------------------------------------------------------------------------
drop trigger if exists trg_reviews_set_updated_at on public.reviews;
create trigger trg_reviews_set_updated_at
  before update on public.reviews
  for each row
  execute function public.set_updated_at();

drop trigger if exists trg_review_answers_set_updated_at on public.review_answers;
create trigger trg_review_answers_set_updated_at
  before update on public.review_answers
  for each row
  execute function public.set_updated_at();

-- ----------------------------------------------------------------------------
-- 4. review_answers validity (a CHECK can't span tables). Validates:
--    (a) the answered question belongs to the same cycle as the review's
--        proposal AND its stage matches the review's stage -- so a reviewer
--        can't attach answers for foreign questions that would inflate totals;
--    (b) the score (when present) is within that question's min..max.
--    SECURITY DEFINER so the lookups aren't limited by RLS.
-- ----------------------------------------------------------------------------
create or replace function public.enforce_review_answer_score_range()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_min            int;
  v_max            int;
  v_q_cycle        uuid;
  v_q_stage        text;
  v_review_stage   text;
  v_proposal_cycle uuid;
begin
  select score_min, score_max, cycle_id, stage
    into v_min, v_max, v_q_cycle, v_q_stage
  from public.review_questions
  where id = new.question_id;
  if v_min is null then
    raise exception 'Question not found for this answer'
      using errcode = '23503';
  end if;

  select r.stage, p.cycle_id
    into v_review_stage, v_proposal_cycle
  from public.reviews r
  join public.proposals p on p.id = r.proposal_id
  where r.id = new.review_id;
  if v_review_stage is null then
    raise exception 'Review not found for this answer'
      using errcode = '23503';
  end if;

  -- (a) the question must belong to the review's proposal's cycle and stage.
  if v_q_cycle is distinct from v_proposal_cycle
     or v_q_stage is distinct from v_review_stage then
    raise exception
      'This question does not belong to the review''s cycle and stage'
      using errcode = '42501';
  end if;

  -- (b) score range.
  if new.score is not null then
    if new.score < v_min or new.score > v_max then
      raise exception 'Score must be between % and % for this question', v_min, v_max
        using errcode = '23514';
    end if;
  end if;

  return new;
end;
$$;

drop trigger if exists trg_review_answers_score_range on public.review_answers;
create trigger trg_review_answers_score_range
  before insert or update on public.review_answers
  for each row
  execute function public.enforce_review_answer_score_range();

-- ----------------------------------------------------------------------------
-- 5. Lock helpers + guards
-- ----------------------------------------------------------------------------
create or replace function public.review_is_editable(r_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.reviews
    where id = r_id
      and state in ('draft', 'reopened')
  );
$$;

create or replace function public.owns_review(r_id uuid, uid uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.reviews
    where id = r_id
      and reviewer_id = uid
  );
$$;

-- review_answers: locked once the parent review is submitted. Branch on TG_OP
-- so NEW is never touched on DELETE (nor OLD on INSERT).
create or replace function public.enforce_review_answer_lock()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_review_id uuid;
begin
  if tg_op = 'DELETE' then
    v_review_id := old.review_id;
  else
    v_review_id := new.review_id;
  end if;

  if auth.uid() is null or public.is_manager(auth.uid()) then
    if tg_op = 'DELETE' then
      return old;
    end if;
    return new;
  end if;

  if not public.review_is_editable(v_review_id) then
    raise exception 'This review is locked and can no longer be edited'
      using errcode = '42501';
  end if;

  if tg_op = 'DELETE' then
    return old;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_review_answers_lock on public.review_answers;
create trigger trg_review_answers_lock
  before insert or update or delete on public.review_answers
  for each row
  execute function public.enforce_review_answer_lock();

-- reviews: restrict what a reviewer may set/change. The RPCs set a txn-local
-- flag to bypass, since they run with the reviewer's auth.uid().
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

  -- Reviewer INSERT: a new review must be your own clean draft.
  if tg_op = 'INSERT' then
    if new.state <> 'draft'
       or new.submitted_at is not null
       or new.reopened_at is not null
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

  -- (b) these fields move only via the RPCs or a manager.
  if new.state        is distinct from old.state
     or new.submitted_at is distinct from old.submitted_at
     or new.reopened_at  is distinct from old.reopened_at
     or new.proposal_id  is distinct from old.proposal_id
     or new.reviewer_id  is distinct from old.reviewer_id
     or new.stage        is distinct from old.stage
  then
    raise exception 'You are not allowed to change that field on a review'
      using errcode = '42501';
  end if;

  return new;
end;
$$;

drop trigger if exists trg_reviews_owner_rules on public.reviews;
create trigger trg_reviews_owner_rules
  before insert or update on public.reviews
  for each row
  execute function public.enforce_review_owner_rules();

-- ----------------------------------------------------------------------------
-- 6. RPCs
-- ----------------------------------------------------------------------------

-- Reviewer submits their own review; every active question for the proposal's
-- cycle + the review's stage must have a scored answer.
create or replace function public.submit_review(r_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_owner       uuid;
  v_state       text;
  v_proposal    uuid;
  v_stage       text;
  v_cycle       uuid;
  v_unanswered  int;
begin
  select reviewer_id, state, proposal_id, stage
    into v_owner, v_state, v_proposal, v_stage
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

-- Manager reopens a submitted review so the reviewer can fix it.
create or replace function public.reopen_review(r_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_state text;
begin
  if not public.is_manager(auth.uid()) then
    raise exception 'Only a manager may reopen a review' using errcode = '42501';
  end if;

  select state into v_state
  from public.reviews
  where id = r_id
  for update;

  if v_state is null then
    raise exception 'Review not found' using errcode = 'P0002';
  end if;
  if v_state <> 'submitted' then
    raise exception 'Only a submitted review can be reopened' using errcode = '42501';
  end if;

  perform set_config('app.review_rpc', 'on', true);
  update public.reviews
  set state = 'reopened', reopened_at = now()
  where id = r_id;
  perform set_config('app.review_rpc', 'off', true);
end;
$$;

revoke all on function public.submit_review(uuid) from public, anon;
revoke all on function public.reopen_review(uuid) from public, anon;
grant execute on function public.submit_review(uuid) to authenticated;
grant execute on function public.reopen_review(uuid) to authenticated;

-- ----------------------------------------------------------------------------
-- 7. Row Level Security -- reviews are SILOED (owner + manager only)
-- ----------------------------------------------------------------------------

-- reviews --------------------------------------------------------------------
grant select, insert, update on public.reviews to authenticated;
alter table public.reviews enable row level security;

drop policy if exists "reviews_select_own"     on public.reviews;
drop policy if exists "reviews_insert_own"     on public.reviews;
drop policy if exists "reviews_update_own"     on public.reviews;
drop policy if exists "reviews_select_manager" on public.reviews;
drop policy if exists "reviews_update_manager" on public.reviews;

-- A reviewer sees ONLY their own review. There is deliberately NO policy that
-- lets one committee member see another's review -- this is the siloing rule.
create policy "reviews_select_own"
  on public.reviews for select to authenticated
  using (reviewer_id = auth.uid());

create policy "reviews_insert_own"
  on public.reviews for insert to authenticated
  with check (
    reviewer_id = auth.uid()
    and public.is_committee(auth.uid())
    and public.proposal_visible_to_committee(proposal_id)
  );

create policy "reviews_update_own"
  on public.reviews for update to authenticated
  using (reviewer_id = auth.uid())
  with check (reviewer_id = auth.uid());

create policy "reviews_select_manager"
  on public.reviews for select to authenticated
  using (public.is_manager(auth.uid()));

create policy "reviews_update_manager"
  on public.reviews for update to authenticated
  using (public.is_manager(auth.uid()))
  with check (public.is_manager(auth.uid()));

-- No delete policy on reviews -- reviews are not deleted.

-- review_answers -------------------------------------------------------------
grant select, insert, update, delete on public.review_answers to authenticated;
alter table public.review_answers enable row level security;

drop policy if exists "review_answers_select_own"     on public.review_answers;
drop policy if exists "review_answers_insert_own"     on public.review_answers;
drop policy if exists "review_answers_update_own"     on public.review_answers;
drop policy if exists "review_answers_delete_own"     on public.review_answers;
drop policy if exists "review_answers_select_manager" on public.review_answers;

-- A reviewer manages ONLY answers of a review they own. No policy exposes
-- another reviewer's answers to a committee member.
create policy "review_answers_select_own"
  on public.review_answers for select to authenticated
  using (public.owns_review(review_id, auth.uid()));

create policy "review_answers_insert_own"
  on public.review_answers for insert to authenticated
  with check (public.owns_review(review_id, auth.uid()));

create policy "review_answers_update_own"
  on public.review_answers for update to authenticated
  using (public.owns_review(review_id, auth.uid()))
  with check (public.owns_review(review_id, auth.uid()));

create policy "review_answers_delete_own"
  on public.review_answers for delete to authenticated
  using (public.owns_review(review_id, auth.uid()));

create policy "review_answers_select_manager"
  on public.review_answers for select to authenticated
  using (public.is_manager(auth.uid()));
