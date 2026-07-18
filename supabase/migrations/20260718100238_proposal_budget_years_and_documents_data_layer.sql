-- ============================================================================
-- Migration: proposal budget years and documents data layer (part 2 of 2)
-- A new multi-year proposal carries a PLAN (planned amounts per project year);
-- the actual ask for the cycle lives on proposals.requested_amount. Documents
-- are uploaded against the per-cycle+stage document_requirements slots and
-- stored in a private 'proposals' bucket.
--
-- Reuses existing functions: public.is_manager(uuid),
--   public.is_approved_researcher(uuid), public.set_updated_at().
-- Adds: public.owns_proposal(uuid,uuid), public.proposal_is_editable(uuid).
--
-- NOTE: apply by pasting into the Supabase dashboard SQL editor.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. Helper: owns_proposal(p_id, uid)
--    SECURITY DEFINER so it BYPASSES RLS (needed by storage policies without
--    recursion). True when that proposal's researcher_id = uid.
-- ----------------------------------------------------------------------------
create or replace function public.owns_proposal(p_id uuid, uid uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.proposals
    where id = p_id
      and researcher_id = uid
  );
$$;

-- ----------------------------------------------------------------------------
-- 2. Helper: proposal_is_editable(p_id)
--    SECURITY DEFINER, STABLE. True when the proposal is in 'draft' or
--    'reopened' -- used to lock documents/budget once submitted.
-- ----------------------------------------------------------------------------
create or replace function public.proposal_is_editable(p_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.proposals
    where id = p_id
      and state in ('draft', 'reopened')
  );
$$;

-- ----------------------------------------------------------------------------
-- 3. proposal_budget_years table -- the multi-year PLAN
-- ----------------------------------------------------------------------------
create table if not exists public.proposal_budget_years (
  id             uuid primary key default gen_random_uuid(),
  proposal_id    uuid not null references public.proposals (id) on delete cascade,
  year_number    int not null check (year_number between 1 and 10),
  planned_amount numeric(14, 2) not null check (planned_amount >= 0),
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  unique (proposal_id, year_number)
);

create index if not exists proposal_budget_years_proposal_idx
  on public.proposal_budget_years (proposal_id);

-- ----------------------------------------------------------------------------
-- 4. proposal_documents table -- one uploaded file per requirement slot
-- ----------------------------------------------------------------------------
create table if not exists public.proposal_documents (
  id             uuid primary key default gen_random_uuid(),
  proposal_id    uuid not null references public.proposals (id) on delete cascade,
  requirement_id uuid not null references public.document_requirements (id) on delete restrict,
  file_path      text not null,   -- path in the 'proposals' storage bucket
  file_name      text not null,   -- original filename for display
  file_size      int,
  uploaded_at    timestamptz not null default now(),
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  unique (proposal_id, requirement_id)   -- one file per slot; re-upload replaces the row
);

create index if not exists proposal_documents_proposal_idx
  on public.proposal_documents (proposal_id);

-- ----------------------------------------------------------------------------
-- 5. updated_at triggers (reuse existing public.set_updated_at())
-- ----------------------------------------------------------------------------
drop trigger if exists trg_proposal_budget_years_set_updated_at on public.proposal_budget_years;
create trigger trg_proposal_budget_years_set_updated_at
  before update on public.proposal_budget_years
  for each row
  execute function public.set_updated_at();

drop trigger if exists trg_proposal_documents_set_updated_at on public.proposal_documents;
create trigger trg_proposal_documents_set_updated_at
  before update on public.proposal_documents
  for each row
  execute function public.set_updated_at();

-- ----------------------------------------------------------------------------
-- 6. Lock guards -- both tables are locked once the parent proposal is
--    submitted. Shared function (both tables have proposal_id).
-- ----------------------------------------------------------------------------
create or replace function public.enforce_proposal_child_lock()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  -- Admin (dashboard) or manager: allow everything.
  if auth.uid() is null or public.is_manager(auth.uid()) then
    return coalesce(new, old);
  end if;

  -- Otherwise the parent proposal must still be editable (draft/reopened).
  if not public.proposal_is_editable(coalesce(new.proposal_id, old.proposal_id)) then
    raise exception 'This proposal is locked and can no longer be edited'
      using errcode = '42501';
  end if;

  return coalesce(new, old);
end;
$$;

drop trigger if exists trg_proposal_budget_years_lock on public.proposal_budget_years;
create trigger trg_proposal_budget_years_lock
  before insert or update or delete on public.proposal_budget_years
  for each row
  execute function public.enforce_proposal_child_lock();

drop trigger if exists trg_proposal_documents_lock on public.proposal_documents;
create trigger trg_proposal_documents_lock
  before insert or update or delete on public.proposal_documents
  for each row
  execute function public.enforce_proposal_child_lock();

-- ----------------------------------------------------------------------------
-- 7. Row Level Security
--    Researchers manage rows for proposals they own (incl. DELETE -- normal
--    draft editing; the lock guard prevents it after submission). Managers
--    read all and update all.
-- ----------------------------------------------------------------------------

-- proposal_budget_years -----------------------------------------------------
grant select, insert, update, delete on public.proposal_budget_years to authenticated;
alter table public.proposal_budget_years enable row level security;

drop policy if exists "budget_years_select_own"     on public.proposal_budget_years;
drop policy if exists "budget_years_insert_own"     on public.proposal_budget_years;
drop policy if exists "budget_years_update_own"     on public.proposal_budget_years;
drop policy if exists "budget_years_delete_own"     on public.proposal_budget_years;
drop policy if exists "budget_years_select_manager" on public.proposal_budget_years;
drop policy if exists "budget_years_update_manager" on public.proposal_budget_years;

create policy "budget_years_select_own"
  on public.proposal_budget_years for select to authenticated
  using (public.owns_proposal(proposal_id, auth.uid()));

create policy "budget_years_insert_own"
  on public.proposal_budget_years for insert to authenticated
  with check (public.owns_proposal(proposal_id, auth.uid()));

create policy "budget_years_update_own"
  on public.proposal_budget_years for update to authenticated
  using (public.owns_proposal(proposal_id, auth.uid()))
  with check (public.owns_proposal(proposal_id, auth.uid()));

create policy "budget_years_delete_own"
  on public.proposal_budget_years for delete to authenticated
  using (public.owns_proposal(proposal_id, auth.uid()));

create policy "budget_years_select_manager"
  on public.proposal_budget_years for select to authenticated
  using (public.is_manager(auth.uid()));

create policy "budget_years_update_manager"
  on public.proposal_budget_years for update to authenticated
  using (public.is_manager(auth.uid()))
  with check (public.is_manager(auth.uid()));

-- proposal_documents --------------------------------------------------------
grant select, insert, update, delete on public.proposal_documents to authenticated;
alter table public.proposal_documents enable row level security;

drop policy if exists "proposal_docs_select_own"     on public.proposal_documents;
drop policy if exists "proposal_docs_insert_own"     on public.proposal_documents;
drop policy if exists "proposal_docs_update_own"     on public.proposal_documents;
drop policy if exists "proposal_docs_delete_own"     on public.proposal_documents;
drop policy if exists "proposal_docs_select_manager" on public.proposal_documents;
drop policy if exists "proposal_docs_update_manager" on public.proposal_documents;

create policy "proposal_docs_select_own"
  on public.proposal_documents for select to authenticated
  using (public.owns_proposal(proposal_id, auth.uid()));

create policy "proposal_docs_insert_own"
  on public.proposal_documents for insert to authenticated
  with check (public.owns_proposal(proposal_id, auth.uid()));

create policy "proposal_docs_update_own"
  on public.proposal_documents for update to authenticated
  using (public.owns_proposal(proposal_id, auth.uid()))
  with check (public.owns_proposal(proposal_id, auth.uid()));

create policy "proposal_docs_delete_own"
  on public.proposal_documents for delete to authenticated
  using (public.owns_proposal(proposal_id, auth.uid()));

create policy "proposal_docs_select_manager"
  on public.proposal_documents for select to authenticated
  using (public.is_manager(auth.uid()));

create policy "proposal_docs_update_manager"
  on public.proposal_documents for update to authenticated
  using (public.is_manager(auth.uid()))
  with check (public.is_manager(auth.uid()));

-- ----------------------------------------------------------------------------
-- 8. Storage -- private 'proposals' bucket
--    Files live at '{proposal_id}/{requirement_id}.{ext}'. The owner may
--    read/write objects under a proposal-id folder they own; managers read all.
--    The first path segment is cast to uuid only inside a CASE gated on a uuid
--    pattern, so a malformed segment yields NULL (-> owns_proposal false) and
--    never raises a cast error.
-- ----------------------------------------------------------------------------
insert into storage.buckets (id, name, public)
values ('proposals', 'proposals', false)
on conflict (id) do nothing;

drop policy if exists "proposals_bucket_insert_own"     on storage.objects;
drop policy if exists "proposals_bucket_select_own"     on storage.objects;
drop policy if exists "proposals_bucket_update_own"     on storage.objects;
drop policy if exists "proposals_bucket_delete_own"     on storage.objects;
drop policy if exists "proposals_bucket_select_manager" on storage.objects;

create policy "proposals_bucket_insert_own"
  on storage.objects for insert to authenticated
  with check (
    bucket_id = 'proposals'
    and public.owns_proposal(
      case
        when (storage.foldername(name))[1] ~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'
        then ((storage.foldername(name))[1])::uuid
      end,
      auth.uid()
    )
  );

create policy "proposals_bucket_select_own"
  on storage.objects for select to authenticated
  using (
    bucket_id = 'proposals'
    and public.owns_proposal(
      case
        when (storage.foldername(name))[1] ~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'
        then ((storage.foldername(name))[1])::uuid
      end,
      auth.uid()
    )
  );

create policy "proposals_bucket_update_own"
  on storage.objects for update to authenticated
  using (
    bucket_id = 'proposals'
    and public.owns_proposal(
      case
        when (storage.foldername(name))[1] ~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'
        then ((storage.foldername(name))[1])::uuid
      end,
      auth.uid()
    )
  )
  with check (
    bucket_id = 'proposals'
    and public.owns_proposal(
      case
        when (storage.foldername(name))[1] ~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'
        then ((storage.foldername(name))[1])::uuid
      end,
      auth.uid()
    )
  );

create policy "proposals_bucket_delete_own"
  on storage.objects for delete to authenticated
  using (
    bucket_id = 'proposals'
    and public.owns_proposal(
      case
        when (storage.foldername(name))[1] ~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'
        then ((storage.foldername(name))[1])::uuid
      end,
      auth.uid()
    )
  );

create policy "proposals_bucket_select_manager"
  on storage.objects for select to authenticated
  using (
    bucket_id = 'proposals'
    and public.is_manager(auth.uid())
  );
