-- ============================================================================
-- Migration: yes/no review question type
--
-- Review questions have always been numeric (a score within score_min..score_max).
-- The manager now needs some questions to be a simple YES / NO.
--
-- STORAGE / SCORING DECISION -------------------------------------------------
-- A yes/no answer is stored in the SAME review_answers.score int as every other
-- answer, encoded as:
--       no  -> score = 0
--       yes -> score = score_max   (the question's "points for yes")
-- The manager sets what a "yes" is worth via score_max; score_min is pinned to 0
-- for yes/no questions (constraint below), so "no" is always a valid 0.
--
-- Why this encoding: every roll-up keeps working with NO changes at all.
-- proposal_review_summary sums review_answers.score for total_score and uses
-- sum(score_max) x submitted-reviewer count for max_possible -- a yes/no question
-- contributes 0..score_max exactly like a numeric one, and its score_max IS the
-- maximum attainable (a "yes"). submit_review's "every active question scored"
-- check also still works, because "no" is 0 (non-null) and unanswered is NULL.
-- No aggregate, RPC, or view needs to change. A separate boolean column would
-- have forced special-casing in every aggregate for no benefit.
--
-- Reuses existing functions: public.is_manager(uuid), public.set_updated_at().
-- Does NOT redefine them. Restates only the review_answers validation trigger.
--
-- NOTE: apply by pasting into the Supabase dashboard SQL editor.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. review_questions.question_type
-- ----------------------------------------------------------------------------
alter table public.review_questions
  add column if not exists question_type text not null default 'numeric'
    check (question_type in ('numeric', 'yes_no'));

comment on column public.review_questions.question_type is
  'numeric = a score anywhere in score_min..score_max. yes_no = a two-value '
  'question stored in the same score column: 0 for no, score_max for yes '
  '(score_max is the manager-chosen points for a yes; score_min is pinned to 0). '
  'Encoding it as an ordinary score keeps every roll-up unchanged.';

-- A yes/no question must have score_min = 0 so that "no" (0) is inside the
-- question's own range and the generic range check can never contradict the
-- yes/no rule. Existing rows are all 'numeric', so this validates immediately.
-- Guarded in a DO block because Postgres has no ADD CONSTRAINT IF NOT EXISTS
-- and this file should be safe to re-run.
do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conrelid = 'public.review_questions'::regclass
      and conname = 'review_questions_yes_no_min_zero'
  ) then
    alter table public.review_questions
      add constraint review_questions_yes_no_min_zero
        check (question_type <> 'yes_no' or score_min = 0);
  end if;
end
$$;

-- NOTE: the pre-existing constraint review_questions_score_range
-- (score_max > score_min) still applies, so a yes/no question always has
-- score_max >= 1 -- a "yes" is always worth at least one point. That is the
-- desired behaviour; a zero-value yes would be meaningless.

-- ----------------------------------------------------------------------------
-- 2. review_answers validation trigger -- RESTATED in full.
--
--    PRESERVED exactly:
--      * question-not-found (23503) and review-not-found (23503) lookups;
--      * check (a): the answered question must belong to the review's proposal's
--        cycle AND match the review's stage (42501) -- unchanged;
--      * check (b) for NUMERIC questions: score must be within score_min..score_max
--        (23514), same message;
--      * NULL scores are still allowed (an unanswered draft answer row);
--      * SECURITY DEFINER + empty search_path, so the lookups bypass RLS.
--
--    ADDED: for a yes_no question the score must be EXACTLY 0 (no) or EXACTLY
--    score_max (yes) -- nothing in between -- with a clear message.
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
  v_type           text;
  v_q_cycle        uuid;
  v_q_stage        text;
  v_review_stage   text;
  v_proposal_cycle uuid;
begin
  select score_min, score_max, question_type, cycle_id, stage
    into v_min, v_max, v_type, v_q_cycle, v_q_stage
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

  -- (b) score validity, by question type. NULL still means "not answered yet".
  if new.score is not null then
    if v_type = 'yes_no' then
      -- Two-valued: the full points for yes, or 0 for no. Nothing in between.
      if new.score <> 0 and new.score <> v_max then
        raise exception
          'This is a yes/no question: the score must be % for yes or 0 for no',
          v_max
          using errcode = '23514';
      end if;
    else
      if new.score < v_min or new.score > v_max then
        raise exception 'Score must be between % and % for this question', v_min, v_max
          using errcode = '23514';
      end if;
    end if;
  end if;

  return new;
end;
$$;

-- Trigger definition unchanged; restated for a self-contained apply.
drop trigger if exists trg_review_answers_score_range on public.review_answers;
create trigger trg_review_answers_score_range
  before insert or update on public.review_answers
  for each row
  execute function public.enforce_review_answer_score_range();

-- ----------------------------------------------------------------------------
-- 3. Aggregates: DELIBERATELY UNCHANGED.
--    proposal_review_summary is NOT touched by this migration and needs no
--    change: a yes/no answer is an ordinary int inside the question's range, so
--    total_score (sum of scores), max_possible (sum of score_max x submitted
--    reviewing reviewers) and average_score all remain correct. Likewise
--    submit_review's "all active questions scored" check, which only tests for a
--    non-null score.
-- ----------------------------------------------------------------------------
