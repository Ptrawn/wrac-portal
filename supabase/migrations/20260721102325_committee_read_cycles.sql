-- ============================================================================
-- Migration: committee read access to visible cycles
-- The review UI groups proposals by cycle (name + status), but committee had
-- no cycles SELECT policy. Grant read of non-setup cycles, mirroring the
-- approved-researcher policy. Existing cycle policies are untouched.
--
-- Reuses existing functions: public.is_committee(uuid), public.cycle_is_visible(uuid).
--
-- NOTE: apply by pasting into the Supabase dashboard SQL editor.
-- ============================================================================

drop policy if exists "cycles_select_committee" on public.cycles;

create policy "cycles_select_committee"
  on public.cycles for select to authenticated
  using (
    public.is_committee(auth.uid())
    and public.cycle_is_visible(id)
  );
