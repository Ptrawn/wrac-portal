-- ============================================================================
-- Migration: cycle funding report RPC (manager-only)
-- Feeds the Commission report: one row per FUNDED proposal in a cycle, with the
-- researcher/institution, the current-year ask and award, and the multi-year
-- plan total. Off-cycle proposals are included but flagged by `type` so the UI
-- can section them separately (their funding comes from a different source).
--
-- Reuses existing function: public.is_manager(uuid). Does NOT redefine it.
-- Read-only (STABLE) -- no writes, so no bypass flag needed.
--
-- NOTE: apply by pasting into the Supabase dashboard SQL editor.
-- ============================================================================

create or replace function public.cycle_funding_report(p_cycle_id uuid)
returns table (
  proposal_id            uuid,
  project_id             uuid,
  title                  text,
  type                   text,
  researcher_name        text,
  researcher_institution text,
  year_number            int,
  requested_amount       numeric,
  funded_amount          numeric,
  plan_total             numeric,
  planned_years          int
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not public.is_manager(auth.uid()) then
    raise exception 'Only a manager may view the funding report'
      using errcode = '42501';
  end if;

  return query
  select
    p.id,
    p.project_id,
    p.title,
    p.type,
    prof.full_name,
    prof.institution,
    p.year_number,
    p.requested_amount,
    p.funded_amount,
    -- plan_total: sum of this proposal's multi-year plan rows (0 if none).
    coalesce(
      (
        select sum(by.planned_amount)
        from public.proposal_budget_years by
        where by.proposal_id = p.id
      ),
      0
    )::numeric as plan_total,
    proj.planned_years
  from public.proposals p
  join public.profiles prof on prof.id = p.researcher_id
  join public.projects proj on proj.id = p.project_id
  where p.cycle_id = p_cycle_id
    and p.outcome = 'funded'
    and p.type in ('full', 'continuation', 'off_cycle')
  order by p.type, p.funded_amount desc;
end;
$$;

revoke all on function public.cycle_funding_report(uuid) from public, anon;
grant execute on function public.cycle_funding_report(uuid) to authenticated;
