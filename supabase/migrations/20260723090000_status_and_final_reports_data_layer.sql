-- ============================================================================
-- Migration: status and final reports data layer
-- Funded projects owe status reports during the year and a final report at
-- completion. The MANAGER decides how many reports a project owes and each due
-- date (with per-cycle defaults as a starting point). Reports are informational
-- -- there is NO accept/reject; 'submitted' is final, though the manager may
-- reopen one for correction (consistent with proposals/reviews). Committee
-- members read reports, and see a project's FULL reporting history when
-- reviewing a continuation.
--
-- Reports reuse the existing document_requirements slots for stages
-- 'status_report' and 'final_report' -- no parallel document mechanism.
--
-- Reuses existing functions: public.is_manager(uuid), public.is_committee(uuid),
--   public.project_visible_to_committee(uuid), public.set_updated_at().
-- Does NOT redefine them.
--
-- NOTE: apply by pasting into the Supabase dashboard SQL editor.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. Per-cycle default report deadlines (nullable; seed each report's due date)
-- ----------------------------------------------------------------------------
alter table public.cycles
  add column if not exists default_status_report_due_at date;
alter table public.cycles
  add column if not exists default_final_report_due_at date;

-- ----------------------------------------------------------------------------
-- 2. reports table
-- ----------------------------------------------------------------------------
create table if not exists public.reports (
  id           uuid primary key default gen_random_uuid(),
  project_id   uuid not null references public.projects (id) on delete cascade,
  -- the funded proposal/year this report covers (nullable so a report survives
  -- if a proposal row is later removed)
  proposal_id  uuid references public.proposals (id) on delete set null,
  cycle_id     uuid not null references public.cycles (id) on delete restrict,
  type         text not null check (type in ('status', 'final')),
  label        text,                      -- optional manager label, e.g. "Mid-year progress"
  due_date     date,
  state        text not null default 'pending'
                 check (state in ('pending', 'submitted', 'reopened')),
  narrative    text,                      -- the researcher's freeform narrative
  submitted_at timestamptz,
  reopened_at  timestamptz,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

create index if not exists reports_project_idx on public.reports (project_id);
create index if not exists reports_cycle_idx   on public.reports (cycle_id);
create index if not exists reports_state_idx   on public.reports (state);

-- ----------------------------------------------------------------------------
-- 3. report_documents table -- uploaded files against the report's stage slots
-- ----------------------------------------------------------------------------
create table if not exists public.report_documents (
  id             uuid primary key default gen_random_uuid(),
  report_id      uuid not null references public.reports (id) on delete cascade,
  requirement_id uuid not null references public.document_requirements (id) on delete restrict,
  file_path      text not null,   -- path in the 'reports' storage bucket
  file_name      text not null,   -- original filename for display
  file_size      int,
  uploaded_at    timestamptz not null default now(),
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  unique (report_id, requirement_id)     -- one file per slot; re-upload replaces the row
);

create index if not exists report_documents_report_idx
  on public.report_documents (report_id);

-- ----------------------------------------------------------------------------
-- 4. updated_at triggers (reuse existing public.set_updated_at())
-- ----------------------------------------------------------------------------
drop trigger if exists trg_reports_set_updated_at on public.reports;
create trigger trg_reports_set_updated_at
  before update on public.reports
  for each row
  execute function public.set_updated_at();

drop trigger if exists trg_report_documents_set_updated_at on public.report_documents;
create trigger trg_report_documents_set_updated_at
  before update on public.report_documents
  for each row
  execute function public.set_updated_at();

-- ----------------------------------------------------------------------------
-- 5. Helpers (SECURITY DEFINER so policies avoid RLS recursion)
-- ----------------------------------------------------------------------------

-- True when that report's project belongs to uid.
create or replace function public.owns_report(r_id uuid, uid uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.reports r
    join public.projects p on p.id = r.project_id
    where r.id = r_id
      and p.researcher_id = uid
  );
$$;

-- True when the report is still editable (pending or reopened).
create or replace function public.report_is_editable(r_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.reports r
    where r.id = r_id
      and r.state in ('pending', 'reopened')
  );
$$;

-- Just the project-visibility part (the is_committee role check lives in the
-- policy). True when that report's PROJECT is visible to committee.
create or replace function public.report_visible_to_committee(r_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.reports r
    where r.id = r_id
      and public.project_visible_to_committee(r.project_id)
  );
$$;

-- ----------------------------------------------------------------------------
-- 6. Guards
-- ----------------------------------------------------------------------------

-- reports: BEFORE UPDATE. Admin/manager may do anything; sanctioned RPCs bypass
-- via app.report_rpc. The owning researcher may edit ONLY narrative, and only
-- while the report is pending/reopened. (Researchers can't INSERT -- there is no
-- researcher insert policy -- and can't DELETE.)
create or replace function public.enforce_report_owner_rules()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  -- Sanctioned RPC path: this txn-local flag is set only by the report RPCs.
  if current_setting('app.report_rpc', true) = 'on' then
    return new;
  end if;

  -- Admin (dashboard, auth.uid() null) or manager: allow everything.
  if auth.uid() is null or public.is_manager(auth.uid()) then
    return new;
  end if;

  -- Owning researcher: only editable while pending/reopened.
  if old.state not in ('pending', 'reopened') then
    raise exception 'This report is locked and can no longer be edited'
      using errcode = '42501';
  end if;

  -- ...and only the narrative may change.
  if new.state        is distinct from old.state
     or new.submitted_at is distinct from old.submitted_at
     or new.reopened_at  is distinct from old.reopened_at
     or new.due_date     is distinct from old.due_date
     or new.type         is distinct from old.type
     or new.project_id   is distinct from old.project_id
     or new.proposal_id  is distinct from old.proposal_id
     or new.cycle_id     is distinct from old.cycle_id
     or new.label        is distinct from old.label
  then
    raise exception 'You may only edit the narrative on a report'
      using errcode = '42501';
  end if;

  return new;
end;
$$;

drop trigger if exists trg_reports_owner_rules on public.reports;
create trigger trg_reports_owner_rules
  before update on public.reports
  for each row
  execute function public.enforce_report_owner_rules();

-- report_documents: BEFORE INSERT OR UPDATE OR DELETE. Admin/manager allowed;
-- otherwise the parent report must still be editable. Branch on TG_OP so NEW is
-- never referenced on DELETE nor OLD on INSERT.
create or replace function public.enforce_report_document_lock()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_report_id uuid;
begin
  if tg_op = 'DELETE' then
    v_report_id := old.report_id;
  else
    v_report_id := new.report_id;
  end if;

  -- Admin (dashboard) or manager: allow everything.
  if auth.uid() is null or public.is_manager(auth.uid()) then
    if tg_op = 'DELETE' then
      return old;
    end if;
    return new;
  end if;

  -- Otherwise the parent report must still be editable (pending/reopened).
  if not public.report_is_editable(v_report_id) then
    raise exception 'This report is locked and can no longer be edited'
      using errcode = '42501';
  end if;

  if tg_op = 'DELETE' then
    return old;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_report_documents_lock on public.report_documents;
create trigger trg_report_documents_lock
  before insert or update or delete on public.report_documents
  for each row
  execute function public.enforce_report_document_lock();

-- ----------------------------------------------------------------------------
-- 7. RPCs
-- ----------------------------------------------------------------------------

-- Manager creates a report (pending). Falls back to the cycle default due date
-- for the type when p_due_date is null.
create or replace function public.create_report(
  p_project_id uuid,
  p_cycle_id   uuid,
  p_type       text,
  p_label      text,
  p_due_date   date,
  p_proposal_id uuid
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

  v_due := p_due_date;
  if v_due is null then
    select case
             when p_type = 'status' then c.default_status_report_due_at
             else c.default_final_report_due_at
           end
      into v_due
    from public.cycles c
    where c.id = p_cycle_id;
  end if;

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

-- Manager adjusts a report's label / due date, whether or not it's submitted.
create or replace function public.update_report_schedule(
  p_id       uuid,
  p_label    text,
  p_due_date date
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not public.is_manager(auth.uid()) then
    raise exception 'Only a manager may adjust a report schedule'
      using errcode = '42501';
  end if;

  perform 1 from public.reports where id = p_id for update;
  if not found then
    raise exception 'Report not found' using errcode = 'P0002';
  end if;

  perform set_config('app.report_rpc', 'on', true);
  update public.reports
  set label = p_label, due_date = p_due_date
  where id = p_id;
  perform set_config('app.report_rpc', 'off', true);
end;
$$;

-- Manager deletes a mistakenly created report -- only when nothing is submitted:
-- state='pending', no documents, and no narrative.
create or replace function public.delete_report(p_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_state     text;
  v_narrative text;
  v_doc_count int;
begin
  if not public.is_manager(auth.uid()) then
    raise exception 'Only a manager may delete a report' using errcode = '42501';
  end if;

  select state, narrative into v_state, v_narrative
  from public.reports
  where id = p_id
  for update;
  if not found then
    raise exception 'Report not found' using errcode = 'P0002';
  end if;

  select count(*) into v_doc_count
  from public.report_documents
  where report_id = p_id;

  if v_state <> 'pending'
     or v_doc_count > 0
     or (v_narrative is not null and length(btrim(v_narrative)) > 0)
  then
    raise exception
      'Only an empty, unsubmitted report can be deleted (no documents, no narrative).'
      using errcode = '42501';
  end if;

  delete from public.reports where id = p_id;
end;
$$;

-- The owning researcher submits their report. Requires every ACTIVE required
-- document slot for the report's stage to have a file, and a non-empty
-- narrative. A final report completes the project.
create or replace function public.submit_report(p_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_owner     uuid;
  v_state     text;
  v_type      text;
  v_cycle     uuid;
  v_project   uuid;
  v_narrative text;
  v_stage     text;
  v_missing   int;
begin
  select p.researcher_id, r.state, r.type, r.cycle_id, r.project_id, r.narrative
    into v_owner, v_state, v_type, v_cycle, v_project, v_narrative
  from public.reports r
  join public.projects p on p.id = r.project_id
  where r.id = p_id
  for update of r;

  if v_owner is null then
    raise exception 'Report not found' using errcode = 'P0002';
  end if;
  if v_owner <> auth.uid() then
    raise exception 'You can only submit your own report' using errcode = '42501';
  end if;
  if v_state not in ('pending', 'reopened') then
    raise exception 'Only a pending or reopened report can be submitted'
      using errcode = '42501';
  end if;

  v_stage := case when v_type = 'final' then 'final_report' else 'status_report' end;

  -- Every active, required doc slot for this cycle+stage must have a file.
  select count(*) into v_missing
  from public.document_requirements dr
  where dr.cycle_id = v_cycle
    and dr.stage = v_stage
    and dr.is_active = true
    and dr.is_required = true
    and not exists (
      select 1 from public.report_documents rd
      where rd.report_id = p_id
        and rd.requirement_id = dr.id
    );
  if v_missing > 0 then
    raise exception
      'Upload all required documents before submitting (% still missing).', v_missing
      using errcode = '42501';
  end if;

  if v_narrative is null or length(btrim(v_narrative)) = 0 then
    raise exception 'Enter a narrative before submitting the report'
      using errcode = '42501';
  end if;

  perform set_config('app.report_rpc', 'on', true);
  update public.reports
  set state = 'submitted', submitted_at = now()
  where id = p_id;
  perform set_config('app.report_rpc', 'off', true);

  -- A final report completes the project. Promote only from an open state
  -- (never downgrade a completed/declined project) and clear the flag. Guard
  -- bypass mirrors end_project / set_funding_decision.
  if v_type = 'final' then
    perform set_config('app.project_rpc', 'on', true);
    update public.projects
    set status = 'completed', final_report_required = false
    where id = v_project
      and status in ('proposed', 'active', 'ended');
    perform set_config('app.project_rpc', 'off', true);
  end if;
end;
$$;

-- Manager reopens a submitted report for correction.
create or replace function public.reopen_report(p_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_state text;
begin
  if not public.is_manager(auth.uid()) then
    raise exception 'Only a manager may reopen a report' using errcode = '42501';
  end if;

  select state into v_state
  from public.reports
  where id = p_id
  for update;
  if v_state is null then
    raise exception 'Report not found' using errcode = 'P0002';
  end if;
  if v_state <> 'submitted' then
    raise exception 'Only a submitted report can be reopened' using errcode = '42501';
  end if;

  perform set_config('app.report_rpc', 'on', true);
  update public.reports
  set state = 'reopened', reopened_at = now()
  where id = p_id;
  perform set_config('app.report_rpc', 'off', true);
end;
$$;

revoke all on function public.create_report(uuid, uuid, text, text, date, uuid) from public, anon;
revoke all on function public.update_report_schedule(uuid, text, date)          from public, anon;
revoke all on function public.delete_report(uuid)                               from public, anon;
revoke all on function public.submit_report(uuid)                               from public, anon;
revoke all on function public.reopen_report(uuid)                               from public, anon;
grant execute on function public.create_report(uuid, uuid, text, text, date, uuid) to authenticated;
grant execute on function public.update_report_schedule(uuid, text, date)          to authenticated;
grant execute on function public.delete_report(uuid)                               to authenticated;
grant execute on function public.submit_report(uuid)                               to authenticated;
grant execute on function public.reopen_report(uuid)                               to authenticated;

-- ----------------------------------------------------------------------------
-- 8. Row Level Security
-- ----------------------------------------------------------------------------

-- reports -- NO researcher insert/delete (manager creates via SECURITY DEFINER
-- RPCs); researchers select/update their own (guard limits them to narrative).
grant select, update on public.reports to authenticated;
alter table public.reports enable row level security;

drop policy if exists "reports_select_own"       on public.reports;
drop policy if exists "reports_update_own"        on public.reports;
drop policy if exists "reports_select_manager"    on public.reports;
drop policy if exists "reports_update_manager"    on public.reports;
drop policy if exists "reports_select_committee"  on public.reports;

create policy "reports_select_own"
  on public.reports for select to authenticated
  using (public.owns_report(id, auth.uid()));

create policy "reports_update_own"
  on public.reports for update to authenticated
  using (public.owns_report(id, auth.uid()))
  with check (public.owns_report(id, auth.uid()));

create policy "reports_select_manager"
  on public.reports for select to authenticated
  using (public.is_manager(auth.uid()));

create policy "reports_update_manager"
  on public.reports for update to authenticated
  using (public.is_manager(auth.uid()))
  with check (public.is_manager(auth.uid()));

create policy "reports_select_committee"
  on public.reports for select to authenticated
  using (
    public.is_committee(auth.uid())
    and public.report_visible_to_committee(id)
  );

-- report_documents -- researcher manages files for reports they own; the lock
-- guard prevents changes after submission. Manager and committee read.
grant select, insert, update, delete on public.report_documents to authenticated;
alter table public.report_documents enable row level security;

drop policy if exists "report_docs_select_own"      on public.report_documents;
drop policy if exists "report_docs_insert_own"      on public.report_documents;
drop policy if exists "report_docs_update_own"      on public.report_documents;
drop policy if exists "report_docs_delete_own"      on public.report_documents;
drop policy if exists "report_docs_select_manager"  on public.report_documents;
drop policy if exists "report_docs_select_committee" on public.report_documents;

create policy "report_docs_select_own"
  on public.report_documents for select to authenticated
  using (public.owns_report(report_id, auth.uid()));

create policy "report_docs_insert_own"
  on public.report_documents for insert to authenticated
  with check (public.owns_report(report_id, auth.uid()));

create policy "report_docs_update_own"
  on public.report_documents for update to authenticated
  using (public.owns_report(report_id, auth.uid()))
  with check (public.owns_report(report_id, auth.uid()));

create policy "report_docs_delete_own"
  on public.report_documents for delete to authenticated
  using (public.owns_report(report_id, auth.uid()));

create policy "report_docs_select_manager"
  on public.report_documents for select to authenticated
  using (public.is_manager(auth.uid()));

create policy "report_docs_select_committee"
  on public.report_documents for select to authenticated
  using (
    public.is_committee(auth.uid())
    and public.report_visible_to_committee(report_id)
  );

-- ----------------------------------------------------------------------------
-- 9. Storage -- private 'reports' bucket
--    Files live at '{report_id}/{requirement_id}.{ext}'. The first path segment
--    is cast to uuid only inside a CASE gated on a uuid pattern, so a malformed
--    segment yields NULL (-> owns_report false) and never raises a cast error.
--    Writes require the report to still be editable; reads do not.
-- ----------------------------------------------------------------------------
insert into storage.buckets (id, name, public)
values ('reports', 'reports', false)
on conflict (id) do nothing;

drop policy if exists "reports_bucket_insert_own"     on storage.objects;
drop policy if exists "reports_bucket_update_own"     on storage.objects;
drop policy if exists "reports_bucket_delete_own"     on storage.objects;
drop policy if exists "reports_bucket_select_own"     on storage.objects;
drop policy if exists "reports_bucket_select_manager" on storage.objects;
drop policy if exists "reports_bucket_select_committee" on storage.objects;

create policy "reports_bucket_insert_own"
  on storage.objects for insert to authenticated
  with check (
    bucket_id = 'reports'
    and public.owns_report(
      case
        when (storage.foldername(name))[1] ~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'
        then ((storage.foldername(name))[1])::uuid
      end,
      auth.uid()
    )
    and public.report_is_editable(
      case
        when (storage.foldername(name))[1] ~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'
        then ((storage.foldername(name))[1])::uuid
      end
    )
  );

create policy "reports_bucket_update_own"
  on storage.objects for update to authenticated
  using (
    bucket_id = 'reports'
    and public.owns_report(
      case
        when (storage.foldername(name))[1] ~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'
        then ((storage.foldername(name))[1])::uuid
      end,
      auth.uid()
    )
    and public.report_is_editable(
      case
        when (storage.foldername(name))[1] ~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'
        then ((storage.foldername(name))[1])::uuid
      end
    )
  )
  with check (
    bucket_id = 'reports'
    and public.owns_report(
      case
        when (storage.foldername(name))[1] ~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'
        then ((storage.foldername(name))[1])::uuid
      end,
      auth.uid()
    )
    and public.report_is_editable(
      case
        when (storage.foldername(name))[1] ~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'
        then ((storage.foldername(name))[1])::uuid
      end
    )
  );

create policy "reports_bucket_delete_own"
  on storage.objects for delete to authenticated
  using (
    bucket_id = 'reports'
    and public.owns_report(
      case
        when (storage.foldername(name))[1] ~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'
        then ((storage.foldername(name))[1])::uuid
      end,
      auth.uid()
    )
    and public.report_is_editable(
      case
        when (storage.foldername(name))[1] ~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'
        then ((storage.foldername(name))[1])::uuid
      end
    )
  );

create policy "reports_bucket_select_own"
  on storage.objects for select to authenticated
  using (
    bucket_id = 'reports'
    and public.owns_report(
      case
        when (storage.foldername(name))[1] ~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'
        then ((storage.foldername(name))[1])::uuid
      end,
      auth.uid()
    )
  );

create policy "reports_bucket_select_manager"
  on storage.objects for select to authenticated
  using (
    bucket_id = 'reports'
    and public.is_manager(auth.uid())
  );

create policy "reports_bucket_select_committee"
  on storage.objects for select to authenticated
  using (
    bucket_id = 'reports'
    and public.is_committee(auth.uid())
    and public.report_visible_to_committee(
      case
        when (storage.foldername(name))[1] ~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'
        then ((storage.foldername(name))[1])::uuid
      end
    )
  );

-- ----------------------------------------------------------------------------
-- 10. project_reports(p_project_id) -- a project's full reporting history
--     Readable by the owning researcher, a committee member for whom the
--     project is visible, or a manager. This backs the continuation review
--     screen's multi-year reporting context.
-- ----------------------------------------------------------------------------
create or replace function public.project_reports(p_project_id uuid)
returns table (
  report_id    uuid,
  type         text,
  label        text,
  due_date     date,
  state        text,
  narrative    text,
  submitted_at timestamptz,
  cycle_name   text,
  year_number  int
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_owner uuid;
begin
  select researcher_id into v_owner
  from public.projects
  where id = p_project_id;

  if not (
    v_owner = auth.uid()
    or (public.is_committee(auth.uid()) and public.project_visible_to_committee(p_project_id))
    or public.is_manager(auth.uid())
  ) then
    raise exception 'You do not have access to this project''s reports'
      using errcode = '42501';
  end if;

  return query
  select
    r.id,
    r.type,
    r.label,
    r.due_date,
    r.state,
    r.narrative,
    r.submitted_at,
    c.name,
    pp.year_number
  from public.reports r
  join public.cycles c on c.id = r.cycle_id
  left join public.proposals pp on pp.id = r.proposal_id
  where r.project_id = p_project_id
  order by r.due_date nulls last, r.created_at;
end;
$$;

revoke all on function public.project_reports(uuid) from public, anon;
grant execute on function public.project_reports(uuid) to authenticated;
