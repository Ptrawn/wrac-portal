-- ============================================================================
-- Migration: correct the ARC model -- ARC is a CARVE-OUT of the total budget,
-- only SALARY is ARC-eligible, and WSU "magic funds" are reported.
--
-- Three corrections to how a cycle's money is modelled. None of them changes a
-- table, and none of them changes what a funding decision writes.
--
-- 1. ARC IS A SUBSET OF THE TOTAL BUDGET, NOT A SEPARATE POT.
--    The manager enters a gross total (say $1,000,000) and an ARC amount (say
--    $200,000). The main pool available to allocate is therefore $800,000 --
--    the ARC money is carved OUT of the total, not added alongside it. Until
--    now cycle_funding_summary returned the gross total as the pool figure, so
--    the allocation screen overstated the pool by the whole ARC amount.
--
--    cycles.total_budget stays the GROSS total (the raw column is unchanged and
--    is still what the manager types). cycle_funding_summary.total_budget now
--    returns the NET pool -- gross minus the ARC carve-out -- because that is
--    the number the allocation screen and the Commission report mean by
--    "available". See the comment on the return column below.
--
-- 2. ONLY WSU SALARY IS ARC-ELIGIBLE.
--    proposal_arc_ceiling summed all four wsu_* line items (salary, salary
--    benefits, wages, wage benefits). That was wrong: ARC covers salary only.
--    The ceiling is now coalesce(wsu_salary, 0) alone.
--
--    This tightening propagates for free. set_funding_decision already validates
--    arc_amount <= proposal_arc_ceiling(p_id), so narrowing the ceiling means
--    ARC can never exceed salary, and therefore the coverage ratio in item 3 can
--    never exceed 100%. set_funding_decision is deliberately NOT modified.
--
--    NOTE: existing rows are NOT backfilled. A proposal funded under the old
--    rule may already carry an arc_amount above its salary. Nothing here
--    rewrites it; it simply cannot happen again, and such a row would yield a
--    coverage ratio above 1 in item 3. Left as-is by instruction.
--
-- 3. WSU "MAGIC FUNDS" -- a THIRD source, reported but never allocated.
--    WSU covers salary benefits in proportion to how much of the salary the
--    committee moved to ARC:
--
--        coverage = arc_amount / wsu_salary        (0 when there is no salary)
--        magic    = wsu_salary_benefits * coverage
--
--    All salary to ARC => all salary benefits covered by WSU. Half => half.
--    No ARC => no magic. Magic is UNCAPPED: there is no configured magic pot to
--    allocate against, so there is no magic_total/allocated/remaining triplet --
--    only the single figure of what WSU ends up contributing.
--
--    *** MAGIC MONEY DOES NOT REDUCE THE MAIN POOL DRAW. ***
--    WSU pays those benefits directly, outside the WRAC budget entirely. The
--    pool draw formula is UNCHANGED at (funded_amount - arc_amount) and magic is
--    subtracted from nothing. It is a REPORTING figure only. If you are reading
--    this while changing the allocation maths: do not net magic out of anything.
--
-- Reuses existing functions: public.is_manager(uuid). Does NOT redefine them.
-- Does NOT touch set_funding_decision, clear_funding_decision, or any other RPC.
-- Adds no column to any table -- magic is derived on read.
-- Adds no pool or ARC aggregate validation: over-allocation stays deliberately
-- unconstrained, exactly as before.
-- NO BACKFILL. No existing row is changed by this migration.
--
-- NOTE: apply by pasting into the Supabase dashboard SQL editor.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. proposal_arc_ceiling(p_id) -- SALARY ONLY.
--    Was: salary + salary benefits + wages + wage benefits.
--    Now: salary. The other three line items remain informational detail the
--    researcher enters, and wsu_salary_benefits additionally drives the magic
--    figure in item 2 -- but neither is ARC-eligible.
-- ----------------------------------------------------------------------------
create or replace function public.proposal_arc_ceiling(p_id uuid)
returns numeric
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(wsu_salary, 0)
  from public.proposals
  where id = p_id;
$$;

revoke all on function public.proposal_arc_ceiling(uuid) from public, anon;
grant execute on function public.proposal_arc_ceiling(uuid) to authenticated;

comment on function public.proposal_arc_ceiling(uuid) is
  'The cap on proposals.arc_amount: WSU SALARY only. Salary benefits, wages and '
  'wage benefits are informational detail and are NOT ARC-eligible. Enforced by '
  'set_funding_decision, which refuses an arc_amount above this ceiling -- so the '
  'ARC coverage ratio (arc_amount / wsu_salary) can never exceed 1.';

-- ----------------------------------------------------------------------------
-- 1b. Column comments corrected to match the model above. Metadata only -- no
--     column is added, altered or dropped, and no row is touched. The old
--     comments asserted that all four line items formed the ARC-eligible
--     ceiling, which is now false and would mislead the next reader.
-- ----------------------------------------------------------------------------
comment on column public.proposals.wsu_salary is
  'Informational WSU budget line item. Does NOT reconcile against '
  'requested_amount. This item ALONE is the ARC-eligible ceiling (see '
  'public.proposal_arc_ceiling), and is the denominator of the ARC coverage '
  'ratio that drives the WSU magic-funds figure.';
comment on column public.proposals.wsu_salary_benefits is
  'Informational WSU budget line item. NOT ARC-eligible. Covered by WSU "magic '
  'funds" in proportion to ARC salary coverage: '
  'wsu_salary_benefits * (arc_amount / wsu_salary). That money is paid by WSU '
  'directly and never draws on the WRAC pool -- it is reported, never allocated.';
comment on column public.proposals.wsu_wages is
  'Informational WSU budget line item. NOT ARC-eligible and not part of any '
  'tally (see wsu_salary).';
comment on column public.proposals.wsu_wage_benefits is
  'Informational WSU budget line item. NOT ARC-eligible and not part of any '
  'tally (see wsu_salary).';

comment on column public.cycles.arc_fund_total is
  'The per-cycle WSU ARC fund. A CARVE-OUT OF total_budget, not a pot alongside '
  'it: the main pool available to allocate is total_budget - arc_fund_total. '
  'Nullable -- not every cycle uses ARC.';

comment on column public.cycles.total_budget is
  'The GROSS annual budget the manager enters for the cycle. The ARC fund '
  '(arc_fund_total) is carved out of this, so the pool actually available to '
  'allocate is total_budget - arc_fund_total -- which is what '
  'cycle_funding_summary returns as its total_budget column.';

-- ----------------------------------------------------------------------------
-- 2. cycle_funding_summary(p_cycle_id) -- RESTATED IN FULL.
--
--    Changed:
--      * total_budget  -- now the NET pool: gross total_budget minus the ARC
--                         carve-out. The raw cycles.total_budget column remains
--                         the gross figure; this return column is deliberately
--                         the net one, because every caller uses it to mean
--                         "available to allocate".
--      * remaining     -- follows from the net figure: net_budget - allocated.
--      * magic_total   -- NEW. WSU's proportional salary-benefit contribution.
--
--    Unchanged: allocated (still sum(funded_amount - coalesce(arc_amount,0))
--    over funded full/continuation proposals), requested_total, decided_count,
--    undecided_count, offcycle_allocated, arc_fund_total, arc_allocated,
--    arc_remaining. off_cycle is excluded from the pool tallies as before.
--
--    The return shape grows by one column, so the old signature is dropped
--    first -- same approach the previous migration took for this function.
-- ----------------------------------------------------------------------------
drop function if exists public.cycle_funding_summary(uuid);

create or replace function public.cycle_funding_summary(p_cycle_id uuid)
returns table (
  total_budget       numeric,   -- NET of the ARC carve-out (see notes above)
  allocated          numeric,
  remaining          numeric,
  requested_total    numeric,
  decided_count      int,
  undecided_count    int,
  offcycle_allocated numeric,
  arc_fund_total     numeric,
  arc_allocated      numeric,
  arc_remaining      numeric,
  magic_total        numeric    -- reporting only; never reduces the pool draw
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_gross     numeric;   -- cycles.total_budget as entered (gross)
  v_arc_total numeric;   -- cycles.arc_fund_total -- carved OUT of v_gross
  v_net       numeric;   -- the pool actually available to allocate
  v_allocated numeric;   -- net pool draw (funded_amount - arc_amount)
  v_arc_alloc numeric;
  v_magic     numeric;   -- WSU's proportional salary-benefit contribution
begin
  if not public.is_manager(auth.uid()) then
    raise exception 'Only a manager may view the funding summary'
      using errcode = '42501';
  end if;

  select coalesce(c.total_budget, 0), coalesce(c.arc_fund_total, 0)
    into v_gross, v_arc_total
  from public.cycles c
  where c.id = p_cycle_id;
  v_gross     := coalesce(v_gross, 0);       -- cycle not found -> 0
  v_arc_total := coalesce(v_arc_total, 0);   -- cycle not found -> 0

  -- The ARC fund is a carve-out of the gross budget, so the pool available to
  -- allocate is what is left after it. May go negative if the manager sets an
  -- ARC total above the budget -- deliberately not validated here.
  v_net := v_gross - v_arc_total;

  -- Pool allocation excludes off_cycle (separate source) and nets out ARC:
  -- every dollar moved to ARC is freed back into the main pool. arc_allocated
  -- is the sum of those ARC dollars across funded full/continuation proposals.
  --
  -- magic: WSU covers salary benefits in proportion to the share of salary that
  -- went to ARC. nullif() guards the divide when a proposal has no salary (or a
  -- salary of zero) -- the division yields null and the per-row coalesce turns
  -- it into 0, so a proposal with benefits but no salary contributes nothing.
  -- WSU only. This figure is REPORTED, never subtracted from anything.
  select
    coalesce(sum(p.funded_amount - coalesce(p.arc_amount, 0)) filter (
      where p.outcome = 'funded' and p.type in ('full', 'continuation')), 0),
    coalesce(sum(coalesce(p.arc_amount, 0)) filter (
      where p.outcome = 'funded' and p.type in ('full', 'continuation')), 0),
    coalesce(sum(
      coalesce(
        coalesce(p.wsu_salary_benefits, 0)
          -- Clamp coverage at 100%. A proposal can never have more salary in ARC
          -- than it has salary, and set_funding_decision enforces that going
          -- forward (arc_amount <= proposal_arc_ceiling, now salary alone). But
          -- rows funded under the OLD four-line-item ceiling can already carry an
          -- arc_amount above salary, which would otherwise report more magic than
          -- the proposal's entire salary benefits. The clamp makes this formula
          -- self-contained rather than reliant on an invariant enforced elsewhere.
          --
          -- ORDERING MATTERS: Postgres LEAST *ignores* nulls rather than
          -- propagating them -- least(null, 1) is 1, not null. So the ratio must
          -- be coalesced to 0 BEFORE the clamp; clamping first would turn a
          -- no-salary proposal's null ratio into 1 and credit it the full salary
          -- benefits. The outer coalesce below is now belt-and-braces.
          * least(coalesce(coalesce(p.arc_amount, 0) / nullif(p.wsu_salary, 0), 0), 1),
        0)
    ) filter (
      where p.outcome = 'funded'
        and p.type in ('full', 'continuation')
        and p.is_wsu), 0)
    into v_allocated, v_arc_alloc, v_magic
  from public.proposals p
  where p.cycle_id = p_cycle_id;

  return query
  select
    v_net                                      as total_budget,  -- NET of ARC
    v_allocated                                as allocated,     -- net of ARC
    (v_net - v_allocated)                      as remaining,     -- may go negative
    coalesce(sum(p.requested_amount) filter (
      where p.state = 'submitted'
        and p.type in ('full', 'continuation')), 0)::numeric   as requested_total,
    coalesce(count(*) filter (
      where p.state = 'submitted'
        and p.type in ('full', 'continuation')
        and p.outcome is not null), 0)::int                    as decided_count,
    coalesce(count(*) filter (
      where p.state = 'submitted'
        and p.type in ('full', 'continuation')
        and p.outcome is null), 0)::int                        as undecided_count,
    coalesce(sum(p.funded_amount) filter (
      where p.outcome = 'funded' and p.type = 'off_cycle'), 0)::numeric
                                                               as offcycle_allocated,
    v_arc_total                                as arc_fund_total,
    v_arc_alloc                                as arc_allocated,
    (v_arc_total - v_arc_alloc)                as arc_remaining, -- may go negative
    v_magic                                    as magic_total
  from public.proposals p
  where p.cycle_id = p_cycle_id;
end;
$$;

revoke all on function public.cycle_funding_summary(uuid) from public, anon;
grant execute on function public.cycle_funding_summary(uuid) to authenticated;

comment on function public.cycle_funding_summary(uuid) is
  'Per-cycle money tallies for the manager. total_budget is the NET pool (gross '
  'cycles.total_budget minus the arc_fund_total carve-out); allocated is the pool '
  'draw, sum(funded_amount - arc_amount) over funded full/continuation proposals; '
  'magic_total is WSU''s proportional salary-benefit contribution and is REPORTING '
  'ONLY -- it is paid by WSU outside the WRAC budget and reduces no tally here.';
