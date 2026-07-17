-- ============================================================================
-- Migration: list_pending_researchers() RPC
-- The manager approval queue needs each pending researcher's email, which
-- lives in auth.users -- not reachable from a normal client query under RLS.
-- This SECURITY DEFINER function joins profiles -> auth.users for pending
-- researchers, after verifying the caller is a manager.
--
-- NOTE: apply by pasting into the Supabase dashboard SQL editor.
-- ============================================================================

create or replace function public.list_pending_researchers()
returns table (
  id          uuid,
  full_name   text,
  institution text,
  email       text,
  cv_path     text,
  created_at  timestamptz
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not public.is_manager(auth.uid()) then
    raise exception 'Only a manager may list pending researchers'
      using errcode = '42501';
  end if;

  return query
    select
      p.id,
      p.full_name,
      p.institution,
      u.email::text,
      p.cv_path,
      p.created_at
    from public.profiles p
    join auth.users u on u.id = p.id
    where p.status = 'pending'
      and p.role = 'researcher'
    order by p.created_at asc;
end;
$$;

revoke all on function public.list_pending_researchers() from public, anon;
grant execute on function public.list_pending_researchers() to authenticated;
