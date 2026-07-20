-- ============================================================================
-- Migration: committee member invitation data layer
-- The Manager invites committee members by creating their auth account with a
-- temporary password (Supabase admin API, server-side). handle_new_user makes
-- a pending researcher profile for the new row; the invite flow then updates it
-- to role='committee' via the service-role client (auth.uid() null, so the
-- self-elevation guard permits it). handle_new_user is intentionally unchanged.
--
-- Reuses existing functions: public.is_manager(uuid), public.set_updated_at().
-- Adds: public.is_committee(uuid), public.clear_must_change_password().
--
-- NOTE: apply by pasting into the Supabase dashboard SQL editor.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. profiles: invitation + forced-password-change columns
-- ----------------------------------------------------------------------------
alter table public.profiles
  add column if not exists must_change_password boolean not null default false;
alter table public.profiles
  add column if not exists invited_by uuid references public.profiles (id) on delete set null;
alter table public.profiles
  add column if not exists invited_at timestamptz;

-- ----------------------------------------------------------------------------
-- 2. Role helper: is_committee(uid)
--    SECURITY DEFINER so it BYPASSES RLS on profiles (same pattern as
--    is_manager / is_approved_researcher; used by the review slice later).
-- ----------------------------------------------------------------------------
create or replace function public.is_committee(uid uuid)
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
      and role = 'committee'
      and status = 'approved'
  );
$$;

-- ----------------------------------------------------------------------------
-- 3. RPC: clear_must_change_password()
--    Called right after the user sets a new password. Clears the flag for the
--    CALLING user only. The self-elevation guard only fires on role/status
--    changes, so this update passes without a bypass flag (see reply note).
-- ----------------------------------------------------------------------------
create or replace function public.clear_must_change_password()
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null then
    raise exception 'Not signed in' using errcode = '42501';
  end if;

  update public.profiles
  set must_change_password = false
  where id = auth.uid();
end;
$$;

revoke all on function public.clear_must_change_password() from public, anon;
grant execute on function public.clear_must_change_password() to authenticated;
