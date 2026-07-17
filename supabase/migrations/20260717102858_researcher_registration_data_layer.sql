-- ============================================================================
-- Migration: researcher registration data layer
-- Two-stage researcher registration: self-signup creates a pending profile,
-- a manager approves/rejects before the researcher can act.
--
-- NOTE: This file is for version control. It is intended to be applied by
-- pasting it into the Supabase dashboard SQL editor (running as an admin
-- role, where auth.uid() is NULL).
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. profiles table  (one row per auth user)
-- ----------------------------------------------------------------------------
create table if not exists public.profiles (
  id          uuid primary key references auth.users (id) on delete cascade,
  role        text not null default 'researcher'
                check (role in ('researcher', 'committee', 'manager')),
  status      text not null default 'pending'
                check (status in ('pending', 'approved', 'rejected')),
  full_name   text,
  institution text,
  cv_path     text,                       -- nullable; path to CV in storage
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

-- authenticated users act only through RLS (rows filtered by policy below).
grant select, update on public.profiles to authenticated;

-- ----------------------------------------------------------------------------
-- 2. Role helper: is_manager(uid)
--    SECURITY DEFINER so it BYPASSES RLS on profiles. This is what lets RLS
--    policies check role without querying profiles directly (which would
--    recurse into the policy and error). Never check role in a policy by
--    selecting from profiles -- always call this function.
-- ----------------------------------------------------------------------------
create or replace function public.is_manager(uid uuid)
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
      and role = 'manager'
  );
$$;

-- ----------------------------------------------------------------------------
-- 3. Auto-create a profile on signup
--    AFTER INSERT on auth.users -> insert a pending researcher profile,
--    pulling full_name / institution from the new user's raw_user_meta_data
--    (the signup call is expected to pass these).
-- ----------------------------------------------------------------------------
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.profiles (id, role, status, full_name, institution)
  values (
    new.id,
    'researcher',
    'pending',
    new.raw_user_meta_data ->> 'full_name',
    new.raw_user_meta_data ->> 'institution'
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row
  execute function public.handle_new_user();

-- ----------------------------------------------------------------------------
-- 4. keep updated_at current
-- ----------------------------------------------------------------------------
create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists trg_profiles_set_updated_at on public.profiles;
create trigger trg_profiles_set_updated_at
  before update on public.profiles
  for each row
  execute function public.set_updated_at();

-- ----------------------------------------------------------------------------
-- 5. Prevent self-elevation
--    Block any change to role or status UNLESS the caller is a manager, or
--    auth.uid() is NULL (admin acting via the dashboard SQL editor). Stops a
--    researcher from approving themselves or making themselves a manager.
-- ----------------------------------------------------------------------------
create or replace function public.prevent_profile_self_elevation()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if (new.role is distinct from old.role
      or new.status is distinct from old.status)
     and auth.uid() is not null
     and not public.is_manager(auth.uid())
  then
    raise exception
      'Only a manager may change role or status'
      using errcode = '42501';  -- insufficient_privilege
  end if;
  return new;
end;
$$;

drop trigger if exists trg_profiles_prevent_self_elevation on public.profiles;
create trigger trg_profiles_prevent_self_elevation
  before update on public.profiles
  for each row
  execute function public.prevent_profile_self_elevation();

-- ----------------------------------------------------------------------------
-- 6. Row Level Security on profiles
-- ----------------------------------------------------------------------------
alter table public.profiles enable row level security;

drop policy if exists "profiles_select_own"      on public.profiles;
drop policy if exists "profiles_update_own"       on public.profiles;
drop policy if exists "profiles_select_manager"   on public.profiles;

-- users can read their own row
create policy "profiles_select_own"
  on public.profiles
  for select
  to authenticated
  using (id = auth.uid());

-- users can update their own row (role/status changes still gated by the
-- self-elevation trigger above)
create policy "profiles_update_own"
  on public.profiles
  for update
  to authenticated
  using (id = auth.uid())
  with check (id = auth.uid());

-- managers can read every row (via the SECURITY DEFINER helper -- no recursion)
create policy "profiles_select_manager"
  on public.profiles
  for select
  to authenticated
  using (public.is_manager(auth.uid()));

-- ----------------------------------------------------------------------------
-- 7. Approval RPCs (manager-only)
--    Run as SECURITY DEFINER so they can update another user's row; still
--    verify the CALLER is a manager via auth.uid().
-- ----------------------------------------------------------------------------
create or replace function public.approve_researcher(target uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not public.is_manager(auth.uid()) then
    raise exception 'Only a manager may approve researchers'
      using errcode = '42501';
  end if;

  update public.profiles
  set status = 'approved'
  where id = target;
end;
$$;

create or replace function public.reject_researcher(target uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not public.is_manager(auth.uid()) then
    raise exception 'Only a manager may reject researchers'
      using errcode = '42501';
  end if;

  update public.profiles
  set status = 'rejected'
  where id = target;
end;
$$;

revoke all on function public.approve_researcher(uuid) from public, anon;
revoke all on function public.reject_researcher(uuid)  from public, anon;
grant execute on function public.approve_researcher(uuid) to authenticated;
grant execute on function public.reject_researcher(uuid)  to authenticated;

-- ----------------------------------------------------------------------------
-- 8. CV storage: private 'cvs' bucket
--    CVs live at '{user_id}/cv.pdf'. A user may write/read only under their
--    own uid folder; managers may read everything.
-- ----------------------------------------------------------------------------
insert into storage.buckets (id, name, public)
values ('cvs', 'cvs', false)
on conflict (id) do nothing;

drop policy if exists "cvs_insert_own"    on storage.objects;
drop policy if exists "cvs_select_own"     on storage.objects;
drop policy if exists "cvs_update_own"     on storage.objects;
drop policy if exists "cvs_select_manager" on storage.objects;

-- user may upload into their own folder
create policy "cvs_insert_own"
  on storage.objects
  for insert
  to authenticated
  with check (
    bucket_id = 'cvs'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

-- user may read their own files
create policy "cvs_select_own"
  on storage.objects
  for select
  to authenticated
  using (
    bucket_id = 'cvs'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

-- user may overwrite their own files
create policy "cvs_update_own"
  on storage.objects
  for update
  to authenticated
  using (
    bucket_id = 'cvs'
    and (storage.foldername(name))[1] = auth.uid()::text
  )
  with check (
    bucket_id = 'cvs'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

-- managers may read every CV
create policy "cvs_select_manager"
  on storage.objects
  for select
  to authenticated
  using (
    bucket_id = 'cvs'
    and public.is_manager(auth.uid())
  );
