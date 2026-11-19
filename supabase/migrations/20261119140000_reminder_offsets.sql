-- ============================================================================
-- Migration: reminder offsets -- per-cycle overrides, and a shared validity rule
--
-- A reminder email needs to know WHEN to go out: how many days before the
-- deadline. Batch 1 put a reminder_offsets int[] on email_settings and left it
-- unconstrained because nothing read it yet. This migration gives that rule a
-- single definition, applies it there, and adds the per-cycle override the
-- manager needs -- one cycle's full-proposal round may want 30 and 7 days'
-- notice while the next wants 14 and 3, without changing the portal default.
--
-- RESOLUTION ORDER (implemented in lib/email/offsets.ts, not in the database):
--   cycle_email_offsets row  ->  email_settings.reminder_offsets  ->  the
--   catalog's defaultReminderOffsets in code.
-- DELETING a cycle_email_offsets row therefore MEANS "use the default again",
-- which is why managers get DELETE here when they have it nowhere else in this
-- schema. Nothing is lost: the row holds a preference, not a record.
--
-- 1. valid_reminder_offsets(int[]) -- the rule, written ONCE.
--
--    A HELPER, NOT TWO INLINE CHECKS. The same rule has to hold on
--    email_settings.reminder_offsets and on cycle_email_offsets.offsets, and a
--    rule copied into two CHECK expressions is a rule that will eventually
--    disagree with itself -- the next change to the limits would have to find
--    both. It also states the rule in one readable place rather than as a
--    nest of array_length/subscript arithmetic repeated twice. The cost is
--    the known caveat that Postgres does not re-validate existing rows when a
--    function behind a CHECK is later changed; the mitigation is simply to
--    re-validate deliberately (alter table ... validate constraint) if the
--    limits ever move.
--
--    IMMUTABLE because a CHECK constraint requires it, and it genuinely is:
--    the answer depends only on the array passed in.
--
--    NULL is VALID. email_settings.reminder_offsets stays nullable, where null
--    means "no override, use the catalog default". cycle_email_offsets.offsets
--    is NOT NULL separately -- a row there exists only to carry a value.
--
-- 2. cycle_email_offsets -- the per-cycle override.
--    Keyed (cycle_id, email_key): one override per reminder type per cycle.
--    email_key is the catalog key, as in email_settings -- deliberately NOT a
--    foreign key to email_settings, because a type with no settings row is a
--    real and normal state ("off, never touched") and a cycle override must be
--    settable before the type is ever switched on.
--    ON DELETE CASCADE from cycles: an override for a deleted cycle is noise.
--
-- RLS: managers only, all four verbs. Nobody else gets any access -- not
-- researchers, not committee, not anon. The scheduled jobs read this table with
-- the service-role client, which bypasses RLS entirely.
--
-- NO BACKFILL: every cycle starts on the defaults, which is what it has today.
--
-- Reuses existing functions: public.is_manager(uuid), public.set_updated_at().
-- Does NOT redefine them.
--
-- NOTE: apply by pasting into the Supabase dashboard SQL editor.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. The shared validity rule
-- ----------------------------------------------------------------------------
create or replace function public.valid_reminder_offsets(p_offsets int[])
returns boolean
language sql
immutable
set search_path = ''
as $$
  select
    p_offsets is null
    or (
      -- A one-dimensional array of one or two values. array_ndims guards
      -- against a nested array; cardinality counts elements regardless of the
      -- array's lower bound, which array_length(x, 1) alone would not.
      array_ndims(p_offsets) = 1
      and cardinality(p_offsets) between 1 and 2
      -- Every value a sane number of days. 120 is about four months: further
      -- out than that and a "reminder" is just mail about something the
      -- recipient cannot act on yet.
      and not exists (
        select 1 from unnest(p_offsets) o
        where o is null or o < 1 or o > 120
      )
      -- Distinct, because two equal offsets would make the job pick one and
      -- silently ignore the other.
      and cardinality(p_offsets) = (
        select count(distinct o) from unnest(p_offsets) o
      )
    );
$$;

comment on function public.valid_reminder_offsets(int[]) is
  'True when the array is null, or is one or two distinct whole days between '
  '1 and 120. The single definition of a valid reminder schedule; used by the '
  'CHECK on email_settings.reminder_offsets and on cycle_email_offsets.offsets.';

-- ----------------------------------------------------------------------------
-- 2. Constrain the existing column (previously unconstrained)
-- ----------------------------------------------------------------------------
alter table public.email_settings
  drop constraint if exists email_settings_reminder_offsets_valid;

alter table public.email_settings
  add constraint email_settings_reminder_offsets_valid
  check (public.valid_reminder_offsets(reminder_offsets));

-- ----------------------------------------------------------------------------
-- 3. cycle_email_offsets -- per-cycle override
-- ----------------------------------------------------------------------------
create table if not exists public.cycle_email_offsets (
  cycle_id   uuid not null references public.cycles (id) on delete cascade,
  email_key  text not null,          -- catalog key, e.g. 'full_proposal_due'
  offsets    int[] not null
               constraint cycle_email_offsets_valid
               check (public.valid_reminder_offsets(offsets)),
  updated_at timestamptz not null default now(),
  updated_by uuid references auth.users (id) on delete set null,
  primary key (cycle_id, email_key)
);

comment on table public.cycle_email_offsets is
  'Per-cycle override of a reminder email''s schedule. A missing row means '
  'fall back to email_settings.reminder_offsets, then to the catalog default. '
  'Deleting a row is how a manager returns a cycle to the default.';
comment on column public.cycle_email_offsets.email_key is
  'Catalog key of a reminder-kind email type. Not a foreign key: a type with '
  'no email_settings row is normal (it means off), and an override may be set '
  'before the type is ever switched on.';
comment on column public.cycle_email_offsets.offsets is
  'Days BEFORE the deadline to send, e.g. {30,7}. One or two distinct values, '
  '1-120. For report_overdue the single value means days AFTER the due date.';

drop trigger if exists trg_cycle_email_offsets_set_updated_at
  on public.cycle_email_offsets;
create trigger trg_cycle_email_offsets_set_updated_at
  before update on public.cycle_email_offsets
  for each row
  execute function public.set_updated_at();

-- ----------------------------------------------------------------------------
-- 4. Row Level Security -- manager-only, all four verbs.
--    DELETE is granted here, unlike anywhere else in this schema, because
--    deleting a row is the only way to say "this cycle has no override" --
--    see the header. There is no history to preserve.
-- ----------------------------------------------------------------------------
grant select, insert, update, delete on public.cycle_email_offsets to authenticated;
alter table public.cycle_email_offsets enable row level security;

drop policy if exists "cycle_email_offsets_select_manager" on public.cycle_email_offsets;
drop policy if exists "cycle_email_offsets_insert_manager" on public.cycle_email_offsets;
drop policy if exists "cycle_email_offsets_update_manager" on public.cycle_email_offsets;
drop policy if exists "cycle_email_offsets_delete_manager" on public.cycle_email_offsets;

create policy "cycle_email_offsets_select_manager"
  on public.cycle_email_offsets for select to authenticated
  using (public.is_manager(auth.uid()));

create policy "cycle_email_offsets_insert_manager"
  on public.cycle_email_offsets for insert to authenticated
  with check (public.is_manager(auth.uid()));

create policy "cycle_email_offsets_update_manager"
  on public.cycle_email_offsets for update to authenticated
  using (public.is_manager(auth.uid()))
  with check (public.is_manager(auth.uid()));

create policy "cycle_email_offsets_delete_manager"
  on public.cycle_email_offsets for delete to authenticated
  using (public.is_manager(auth.uid()));
