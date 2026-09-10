-- ============================================================================
-- Migration: a second status-report default due date on the cycle
--
-- Every funded project now gets TWO status reports plus a final. The two status
-- reports are ordinary reports of type 'status' -- the reports table, its type
-- CHECK, and every other report RPC are deliberately untouched. Two rows of
-- type 'status' were already permitted (there is no unique constraint on
-- (project_id, type) and create_report has never checked for one), so nothing
-- here adds a capability. What it adds is a SECOND CYCLE-LEVEL DEFAULT DUE DATE,
-- so the manager sets both dates once at cycle setup instead of typing the
-- second one on every project.
--
-- The two status reports remain distinguished only by their due date (and the
-- manager's optional label). No ordinal column is added to reports; due-date
-- ordering is sufficient and every display surface already orders by due_date.
--
-- Both status reports continue to use the existing 'status_report'
-- document_requirements stage -- no new stage, no extra slot configuration.
--
-- NO BACKFILL. No existing row is changed by this migration.
--
-- Reuses existing functions: public.is_manager(uuid). Does NOT redefine them.
--
-- NOTE: apply by pasting into the Supabase dashboard SQL editor.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. cycles.default_status_report_2_due_at -- the SECOND status report's
--    default due date.
--
--    NAMING: the existing column keeps its name. Renaming
--    default_status_report_due_at would break every caller (the Cycle type, the
--    edit form, updateCycle, the reports page, create_report) for no benefit,
--    and would need a data migration. So the first report's default stays
--    unnumbered and the second is suffixed "_2", which keeps the pair adjacent
--    under a shared prefix in \d output and in any column listing, and leaves an
--    obvious slot if a third is ever needed.
--
--    Because "unnumbered = first" is a convention rather than something the name
--    states, BOTH columns get a comment saying which is which.
-- ----------------------------------------------------------------------------
alter table public.cycles
  add column if not exists default_status_report_2_due_at date;

comment on column public.cycles.default_status_report_due_at is
  'Default due date for the FIRST status report of the cycle. Seeds '
  'reports.due_date when a manager creates a status report without giving an '
  'explicit date (create_report, p_status_index = 1, the default). Nullable -- '
  'the manager may set the date per report instead. Deliberately NOT renamed to '
  '..._1_... : every caller reads this name.';

comment on column public.cycles.default_status_report_2_due_at is
  'Default due date for the SECOND status report of the cycle. Seeds '
  'reports.due_date when a manager creates a status report with '
  'create_report(p_status_index => 2). Nullable. Both status reports are '
  'ordinary type = ''status'' rows -- this column only decides which default '
  'date seeds the new report, nothing else distinguishes them.';

-- ----------------------------------------------------------------------------
-- 2. create_report -- RESTATED with a new optional p_status_index parameter.
--
--    SIGNATURE CHANGE, HANDLED EXPLICITLY. Postgres identifies a function by
--    its argument types, so adding a parameter does NOT replace the old function
--    -- `create or replace` would leave the 6-argument version live alongside a
--    new 7-argument one. Worse, because the new parameter is DEFAULTED, a
--    6-argument call would then match both and fail with
--    "function name is not unique". The old signature is therefore dropped
--    first, exactly as this schema already does for set_funding_decision
--    (20260816160000) and cycle_funding_summary (20260816090000).
--
--    p_status_index is the LAST parameter and defaults to 1, so every existing
--    caller -- including the createReport server action, which calls by name
--    with six arguments -- keeps working unchanged and keeps today's behaviour.
--
--    Preserved exactly: the manager-only gate, the type in ('status','final')
--    validation, p_due_date taking precedence over any cycle default, the
--    'final' branch reading default_final_report_due_at, and the insert itself
--    (still type = p_type, still state 'pending').
--
--    Added: p_status_index selects which status default to fall back to, and a
--    range check on it so an out-of-range index fails loudly instead of quietly
--    producing a null due date.
-- ----------------------------------------------------------------------------
drop function if exists public.create_report(uuid, uuid, text, text, date, uuid);

create or replace function public.create_report(
  p_project_id   uuid,
  p_cycle_id     uuid,
  p_type         text,
  p_label        text,
  p_due_date     date,
  p_proposal_id  uuid,
  p_status_index int default 1
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_due    date;
  v_new_id uuid;
begin
  if not public.is_manager(auth.uid()) then
    raise exception 'Only a manager may create a report' using errcode = '42501';
  end if;
  if p_type not in ('status', 'final') then
    raise exception 'A report type must be status or final' using errcode = '22023';
  end if;
  -- Only meaningful for a status report; ignored for 'final'.
  if p_type = 'status' and coalesce(p_status_index, 1) not in (1, 2) then
    raise exception
      'A status report index must be 1 or 2 (got %).', p_status_index
      using errcode = '22023';
  end if;

  -- An explicit date always wins; the cycle default is only a fallback.
  v_due := p_due_date;
  if v_due is null then
    select case
             when p_type = 'final' then c.default_final_report_due_at
             when coalesce(p_status_index, 1) = 2
               then c.default_status_report_2_due_at
             else c.default_status_report_due_at
           end
      into v_due
    from public.cycles c
    where c.id = p_cycle_id;
  end if;

  -- Both status reports are written as type 'status'. p_status_index chose the
  -- default date above and is deliberately NOT stored -- the reports table is
  -- untouched by this migration.
  insert into public.reports (
    project_id, proposal_id, cycle_id, type, label, due_date, state
  )
  values (
    p_project_id, p_proposal_id, p_cycle_id, p_type, p_label, v_due, 'pending'
  )
  returning id into v_new_id;

  return v_new_id;
end;
$$;

revoke all on function public.create_report(uuid, uuid, text, text, date, uuid, int)
  from public, anon;
grant execute on function public.create_report(uuid, uuid, text, text, date, uuid, int)
  to authenticated;
