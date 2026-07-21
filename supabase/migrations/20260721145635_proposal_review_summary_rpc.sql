-- ============================================================================
-- Migration: proposal_review_summary(cycle) RPC -- manager score roll-ups
-- One row per proposal in the cycle: submitted/in-progress review counts, the
-- summed and averaged scores across SUBMITTED reviews only, and the comparable
-- max possible. Computed in one place so the advance decision and the later
-- allocation tool stay consistent.
--
-- Reuses existing function: public.is_manager(uuid).
--
-- NOTE: apply by pasting into the Supabase dashboard SQL editor.
-- ============================================================================

create or replace function public.proposal_review_summary(p_cycle_id uuid)
returns table (
  proposal_id         uuid,
  reviews_submitted   int,
  reviews_in_progress int,
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
    coalesce(sc.total_score, 0)::numeric    as total_score,
    case
      when coalesce(rc.submitted_count, 0) > 0
        then round(coalesce(sc.total_score, 0) / rc.submitted_count, 2)
      else null
    end                                     as average_score,
    (coalesce(sm.max_sum, 0) * coalesce(rc.submitted_count, 0))::numeric
                                            as max_possible
  from public.proposals p
  -- review counts by state
  left join lateral (
    select
      count(*) filter (where r.state = 'submitted')             as submitted_count,
      count(*) filter (where r.state in ('draft', 'reopened'))  as in_progress_count
    from public.reviews r
    where r.proposal_id = p.id
  ) rc on true
  -- summed scores across SUBMITTED reviews only
  left join lateral (
    select sum(a.score)::numeric as total_score
    from public.reviews r
    join public.review_answers a on a.review_id = r.id
    where r.proposal_id = p.id
      and r.state = 'submitted'
  ) sc on true
  -- stage-appropriate max: pre-proposals use 'pre'; everything else 'full'
  left join stage_max sm
    on sm.stage = case when p.type = 'pre' then 'pre' else 'full' end
  where p.cycle_id = p_cycle_id;
end;
$$;

revoke all on function public.proposal_review_summary(uuid) from public, anon;
grant execute on function public.proposal_review_summary(uuid) to authenticated;
