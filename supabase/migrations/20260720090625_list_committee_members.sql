-- ============================================================================
-- Migration: list_committee_members() RPC
-- The committee page needs each member's email (auth.users) which isn't
-- reachable from a client query under RLS. This SECURITY DEFINER function joins
-- profiles -> auth.users for committee members, after verifying the caller is a
-- manager. Mirrors list_pending_researchers.
--
-- NOTE: apply by pasting into the Supabase dashboard SQL editor.
-- ============================================================================

create or replace function public.list_committee_members()
returns table (
  id                   uuid,
  full_name            text,
  email                text,
  invited_at           timestamptz,
  must_change_password boolean
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not public.is_manager(auth.uid()) then
    raise exception 'Only a manager may list committee members'
      using errcode = '42501';
  end if;

  return query
    select
      p.id,
      p.full_name,
      u.email::text,
      p.invited_at,
      p.must_change_password
    from public.profiles p
    join auth.users u on u.id = p.id
    where p.role = 'committee'
    order by p.invited_at desc nulls last, p.created_at desc;
end;
$$;

revoke all on function public.list_committee_members() from public, anon;
grant execute on function public.list_committee_members() to authenticated;
