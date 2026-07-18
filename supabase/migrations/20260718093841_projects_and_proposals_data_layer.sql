-- ============================================================================
-- Migration: projects and proposals data layer (part 1 of 2)
-- A "project" is the multi-year through-line; every proposal belongs to a
-- project. Multi-year projects require a fresh proposal each year
-- (a "continuation"). Budget-years and documents come in a later migration.
--
-- Reuses existing functions: public.is_manager(uuid), public.set_updated_at().
-- Adds:                        public.is_approved_researcher(uuid).
--
-- NOTE: apply by pasting into the Supabase dashboard SQL editor.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. Role helper: is_approved_researcher(uid)
--    SECURITY DEFINER so it BYPASSES RLS on profiles (same reason as
--    is_manager -- avoids RLS recursion when used inside policies).
-- ----------------------------------------------------------------------------
create or replace function public.is_approved_researcher(uid uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.profiles
    where id = uid
      and role = 'researcher'
      and status = 'approved'
  );
$$;

-- ----------------------------------------------------------------------------
-- 2. projects table
-- ----------------------------------------------------------------------------
create table if not exists public.projects (
  id                    uuid primary key default gen_random_uuid(),
  researcher_id         uuid not null references public.profiles (id) on delete restrict,
  title                 text not null,
  planned_years         int not null default 1 check (planned_years between 1 and 10),
  status                text not null default 'proposed'
                          check (status in ('proposed', 'active', 'completed', 'ended', 'declined')),
  ended_at              timestamptz,     -- set when researcher ends the project early
  ended_reason          text,
  final_report_required boolean not null default false,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now()
);

-- ----------------------------------------------------------------------------
-- 3. proposals table
-- ----------------------------------------------------------------------------
create table if not exists public.proposals (
  id                  uuid primary key default gen_random_uuid(),
  project_id          uuid not null references public.projects (id) on delete cascade,
  cycle_id            uuid not null references public.cycles (id) on delete restrict,
  researcher_id       uuid not null references public.profiles (id) on delete restrict,
  type                text not null check (type in ('pre', 'full', 'continuation', 'off_cycle')),
  -- full proposal: the pre-proposal it grew from; continuation: the originating
  -- funded proposal (gives committee context).
  parent_proposal_id  uuid references public.proposals (id) on delete set null,
  title               text not null,
  year_number         int not null default 1 check (year_number >= 1),  -- which project year this request covers
  requested_amount    numeric(14, 2) check (requested_amount is null or requested_amount >= 0),
  state               text not null default 'draft'
                        check (state in ('draft', 'submitted', 'reopened', 'rescinded')),
  outcome             text check (outcome is null or outcome in ('advanced', 'declined', 'funded', 'not_funded')),
  funded_amount       numeric(14, 2) check (funded_amount is null or funded_amount >= 0),
  cv_snapshot_path    text,            -- CV copied from the profile at submission time (point-in-time record)
  submitted_at        timestamptz,
  reopened_at         timestamptz,
  rescinded_at        timestamptz,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);

-- multiple proposals per researcher per cycle ARE allowed -- no unique constraint.
create index if not exists proposals_cycle_type_idx on public.proposals (cycle_id, type);
create index if not exists proposals_researcher_idx on public.proposals (researcher_id);
create index if not exists proposals_project_idx    on public.proposals (project_id);

-- ----------------------------------------------------------------------------
-- 4. updated_at triggers (reuse existing public.set_updated_at())
-- ----------------------------------------------------------------------------
drop trigger if exists trg_projects_set_updated_at on public.projects;
create trigger trg_projects_set_updated_at
  before update on public.projects
  for each row
  execute function public.set_updated_at();

drop trigger if exists trg_proposals_set_updated_at on public.proposals;
create trigger trg_proposals_set_updated_at
  before update on public.proposals
  for each row
  execute function public.set_updated_at();

-- ----------------------------------------------------------------------------
-- 5. Guard triggers on proposals and projects (BEFORE INSERT OR UPDATE)
--    Restrict WHAT a researcher may set/change on their own rows. The
--    sanctioned RPCs (below) set a transaction-local flag to bypass them, since
--    they run with the researcher's auth.uid() and would otherwise be blocked.
-- ----------------------------------------------------------------------------
create or replace function public.enforce_proposal_owner_rules()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  -- Sanctioned RPC path: this txn-local flag is set only by the RPCs below.
  if current_setting('app.proposal_rpc', true) = 'on' then
    return new;
  end if;

  -- Admin (dashboard, auth.uid() null) or manager: allow everything.
  if auth.uid() is null or public.is_manager(auth.uid()) then
    return new;
  end if;

  -- Researcher INSERT: a new proposal must start as a clean draft -- the
  -- outcome/amount/timestamp columns are RPC/manager territory.
  if tg_op = 'INSERT' then
    if new.state <> 'draft'
       or new.outcome is not null
       or new.funded_amount is not null
       or new.submitted_at is not null
       or new.reopened_at is not null
       or new.rescinded_at is not null
    then
      raise exception 'A new proposal must start as a clean draft'
        using errcode = '42501';
    end if;
    return new;
  end if;

  -- Researcher UPDATE on their own row:
  -- (a) a submitted/rescinded proposal is locked entirely.
  if old.state not in ('draft', 'reopened') then
    raise exception 'This proposal is locked and can no longer be edited'
      using errcode = '42501';
  end if;

  -- (b) these fields are set only via the RPCs or by a manager.
  if new.outcome        is distinct from old.outcome
     or new.funded_amount is distinct from old.funded_amount
     or new.state         is distinct from old.state
     or new.submitted_at  is distinct from old.submitted_at
     or new.reopened_at   is distinct from old.reopened_at
     or new.rescinded_at  is distinct from old.rescinded_at
     or new.cycle_id      is distinct from old.cycle_id
     or new.researcher_id is distinct from old.researcher_id
     or new.project_id    is distinct from old.project_id
     or new.type          is distinct from old.type
  then
    raise exception 'You are not allowed to change that field on a proposal'
      using errcode = '42501';
  end if;

  return new;
end;
$$;

drop trigger if exists trg_proposals_owner_rules on public.proposals;
create trigger trg_proposals_owner_rules
  before insert or update on public.proposals
  for each row
  execute function public.enforce_proposal_owner_rules();

-- Projects guard: block researcher-set/changed protected fields. end_project
-- bypasses via the app.project_rpc txn-local flag.
create or replace function public.enforce_project_owner_rules()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  -- Sanctioned RPC path: this txn-local flag is set only by end_project.
  if current_setting('app.project_rpc', true) = 'on' then
    return new;
  end if;

  -- Admin (dashboard, auth.uid() null) or manager: allow everything.
  if auth.uid() is null or public.is_manager(auth.uid()) then
    return new;
  end if;

  -- Researcher INSERT: a new project must start proposed, not ended, no final
  -- report flagged.
  if tg_op = 'INSERT' then
    if new.status <> 'proposed'
       or new.final_report_required <> false
       or new.ended_at is not null
    then
      raise exception 'A new project must start as proposed'
        using errcode = '42501';
    end if;
    return new;
  end if;

  -- Researcher UPDATE: these fields are set only via end_project or by a
  -- manager. Title and planned_years stay owner-editable.
  if new.status                is distinct from old.status
     or new.ended_at              is distinct from old.ended_at
     or new.ended_reason          is distinct from old.ended_reason
     or new.final_report_required is distinct from old.final_report_required
     or new.researcher_id         is distinct from old.researcher_id
  then
    raise exception 'You are not allowed to change that field on a project'
      using errcode = '42501';
  end if;

  return new;
end;
$$;

drop trigger if exists trg_projects_owner_rules on public.projects;
create trigger trg_projects_owner_rules
  before insert or update on public.projects
  for each row
  execute function public.enforce_project_owner_rules();

-- ----------------------------------------------------------------------------
-- 6. RPCs
-- ----------------------------------------------------------------------------

-- Researcher submits their own draft/reopened proposal.
create or replace function public.submit_proposal(p_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_owner uuid;
  v_state text;
begin
  select researcher_id, state into v_owner, v_state
  from public.proposals
  where id = p_id
  for update;

  if v_owner is null then
    raise exception 'Proposal not found' using errcode = 'P0002';
  end if;
  if v_owner <> auth.uid() then
    raise exception 'You can only submit your own proposal' using errcode = '42501';
  end if;
  if v_state not in ('draft', 'reopened') then
    raise exception 'Only a draft or reopened proposal can be submitted' using errcode = '42501';
  end if;

  perform set_config('app.proposal_rpc', 'on', true);
  update public.proposals
  set state = 'submitted', submitted_at = now()
  where id = p_id;
  perform set_config('app.proposal_rpc', 'off', true);
end;
$$;

-- Researcher rescinds their own proposal (never deletes -- preserves history).
create or replace function public.rescind_proposal(p_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_owner uuid;
  v_state text;
begin
  select researcher_id, state into v_owner, v_state
  from public.proposals
  where id = p_id
  for update;

  if v_owner is null then
    raise exception 'Proposal not found' using errcode = 'P0002';
  end if;
  if v_owner <> auth.uid() then
    raise exception 'You can only rescind your own proposal' using errcode = '42501';
  end if;
  if v_state not in ('draft', 'reopened', 'submitted') then
    raise exception 'This proposal cannot be rescinded from its current state' using errcode = '42501';
  end if;

  perform set_config('app.proposal_rpc', 'on', true);
  update public.proposals
  set state = 'rescinded', rescinded_at = now()
  where id = p_id;
  perform set_config('app.proposal_rpc', 'off', true);
end;
$$;

-- Manager reopens a submitted proposal so the researcher can fix it.
create or replace function public.reopen_proposal(p_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_state text;
begin
  if not public.is_manager(auth.uid()) then
    raise exception 'Only a manager may reopen a proposal' using errcode = '42501';
  end if;

  select state into v_state
  from public.proposals
  where id = p_id
  for update;

  if v_state is null then
    raise exception 'Proposal not found' using errcode = 'P0002';
  end if;
  if v_state <> 'submitted' then
    raise exception 'Only a submitted proposal can be reopened' using errcode = '42501';
  end if;

  perform set_config('app.proposal_rpc', 'on', true);
  update public.proposals
  set state = 'reopened', reopened_at = now()
  where id = p_id;
  perform set_config('app.proposal_rpc', 'off', true);
end;
$$;

-- Researcher ends their own project early.
create or replace function public.end_project(p_project_id uuid, p_reason text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_owner uuid;
begin
  select researcher_id into v_owner
  from public.projects
  where id = p_project_id
  for update;

  if v_owner is null then
    raise exception 'Project not found' using errcode = 'P0002';
  end if;
  if v_owner <> auth.uid() then
    raise exception 'You can only end your own project' using errcode = '42501';
  end if;

  perform set_config('app.project_rpc', 'on', true);
  update public.projects
  set status = 'ended',
      ended_at = now(),
      ended_reason = p_reason,
      final_report_required = true
  where id = p_project_id;
  perform set_config('app.project_rpc', 'off', true);
end;
$$;

revoke all on function public.submit_proposal(uuid)  from public, anon;
revoke all on function public.rescind_proposal(uuid) from public, anon;
revoke all on function public.reopen_proposal(uuid)  from public, anon;
revoke all on function public.end_project(uuid, text) from public, anon;
grant execute on function public.submit_proposal(uuid)  to authenticated;
grant execute on function public.rescind_proposal(uuid) to authenticated;
grant execute on function public.reopen_proposal(uuid)  to authenticated;
grant execute on function public.end_project(uuid, text) to authenticated;

-- ----------------------------------------------------------------------------
-- 7. Row Level Security
-- ----------------------------------------------------------------------------

-- projects ------------------------------------------------------------------
grant select, insert, update on public.projects to authenticated;
alter table public.projects enable row level security;

drop policy if exists "projects_select_own"      on public.projects;
drop policy if exists "projects_insert_own"      on public.projects;
drop policy if exists "projects_update_own"      on public.projects;
drop policy if exists "projects_select_manager"  on public.projects;
drop policy if exists "projects_update_manager"  on public.projects;

create policy "projects_select_own"
  on public.projects for select to authenticated
  using (researcher_id = auth.uid());

create policy "projects_insert_own"
  on public.projects for insert to authenticated
  with check (
    researcher_id = auth.uid()
    and public.is_approved_researcher(auth.uid())
  );

create policy "projects_update_own"
  on public.projects for update to authenticated
  using (researcher_id = auth.uid())
  with check (researcher_id = auth.uid());

create policy "projects_select_manager"
  on public.projects for select to authenticated
  using (public.is_manager(auth.uid()));

create policy "projects_update_manager"
  on public.projects for update to authenticated
  using (public.is_manager(auth.uid()))
  with check (public.is_manager(auth.uid()));

-- proposals -----------------------------------------------------------------
grant select, insert, update on public.proposals to authenticated;
alter table public.proposals enable row level security;

drop policy if exists "proposals_select_own"      on public.proposals;
drop policy if exists "proposals_insert_own"      on public.proposals;
drop policy if exists "proposals_update_own"      on public.proposals;
drop policy if exists "proposals_select_manager"  on public.proposals;
drop policy if exists "proposals_update_manager"  on public.proposals;

create policy "proposals_select_own"
  on public.proposals for select to authenticated
  using (researcher_id = auth.uid());

create policy "proposals_insert_own"
  on public.proposals for insert to authenticated
  with check (
    researcher_id = auth.uid()
    and public.is_approved_researcher(auth.uid())
  );

-- The guard trigger restricts WHAT an owner may change; RLS restricts WHICH rows.
create policy "proposals_update_own"
  on public.proposals for update to authenticated
  using (researcher_id = auth.uid())
  with check (researcher_id = auth.uid());

create policy "proposals_select_manager"
  on public.proposals for select to authenticated
  using (public.is_manager(auth.uid()));

create policy "proposals_update_manager"
  on public.proposals for update to authenticated
  using (public.is_manager(auth.uid()))
  with check (public.is_manager(auth.uid()));

-- No delete policies on either table -- records are never deleted.
