-- ============================================================================
-- Migration: capture list_researchers()
--
-- Captures list_researchers(), which was created directly in the database and
-- had no migration. Definition taken from pg_get_functiondef on the live
-- project, 2026-11-18.
--
-- The function backs /manager/researchers: emails live in auth.users, which
-- PostgREST does not expose, so a SECURITY DEFINER RPC is the only way to show
-- them -- and it covers pending, approved and rejected researchers alike.
--
-- This migration records what is ALREADY in the database. Applying it to the
-- live project is a no-op (CREATE OR REPLACE with an identical body); applying
-- it to a rebuilt database restores the function.
--
-- The body is reproduced verbatim from pg_get_functiondef, so its casing and
-- $function$ delimiters differ from the hand-written style used elsewhere in
-- this directory. That is deliberate: it is the live definition, unedited.
--
-- Reuses existing functions: public.is_manager(uuid). Does NOT redefine them.
--
-- NOTE: apply by pasting into the Supabase dashboard SQL editor.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.list_researchers()
 RETURNS TABLE(id uuid, full_name text, institution text, email text, status text, cv_path text, created_at timestamp with time zone)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
  if not public.is_manager(auth.uid()) then
    raise exception 'Only a manager may list researchers' using errcode = '42501';
  end if;
  return query
    select p.id, p.full_name, p.institution, u.email::text,
           p.status, p.cv_path, p.created_at
    from public.profiles p
    join auth.users u on u.id = p.id
    where p.role = 'researcher'
    order by p.created_at desc;
end;
$function$;

revoke all on function public.list_researchers() from public, anon;
grant execute on function public.list_researchers() to authenticated;
