-- ============================================================================
-- Migration: cycles.funding_meeting_at -- the committee's funding/allocation
-- meeting date
--
-- The one date in the annual cycle the schema had no room for. The committee
-- meets to deliberate and allocate the pool, and that meeting is what the
-- deliberation and funding-decision stages are scheduled around -- but until
-- now the manager had nowhere to record it, so it lived in email threads and
-- calendars outside the portal. The allocation tool is run on a screen in that
-- meeting (see CLAUDE.md), which makes its date part of the cycle, not trivia.
--
-- A PACIFIC CALENDAR DATE, exactly like every other cycle date: `date`, not
-- `timestamptz`. The portal treats cycle dates as whole days in
-- America/Los_Angeles and formats them by parsing the y/m/d parts, never by
-- constructing a Date, so a `date` column cannot drift a day under UTC. The
-- meeting's time of day is not modelled -- nothing in the portal needs it, and
-- a timestamptz would invite a 4pm-Pacific meeting to render as the next day.
--
-- NULLABLE, like the rest of the calendar. The manager fills a cycle in
-- incrementally during setup, and a cycle with no meeting booked yet is a
-- normal state rather than an error.
--
-- NO ORDERING CONSTRAINT, deliberately. The sibling dates carry null-tolerant
-- CHECKs (cycles_full_review_after_full_due and friends) because each one
-- gates a stage transition the portal enforces. This date gates nothing: it is
-- recorded and displayed. A constraint tying it after full_review_due_at would
-- only stop a manager booking the room before the review deadline is set --
-- a real sequence in a compressed year -- in exchange for catching a typo the
-- edit form already shows them. The second status-report default date
-- (20260910090000) was added the same way, for the same reason.
--
-- NO BACKFILL. No existing row or column is changed, no function is touched.
-- No RPC returns cycle rows by an explicit column list, so none needs
-- restating: cycle_tiles_for_manager and committee_dashboard both return
-- DERIVED next-deadline columns chosen by status, and the manager's cycle
-- screens read public.cycles directly with select('*').
--
-- NOTE: apply by pasting into the Supabase dashboard SQL editor.
-- ============================================================================

alter table public.cycles
  add column if not exists funding_meeting_at date;

comment on column public.cycles.funding_meeting_at is
  'Date of the committee''s funding/allocation meeting for this cycle -- the '
  'deliberation session the manager drives the allocation tool in. A Pacific '
  'calendar date, like every other cycle date (whole day, no time of day). '
  'Nullable: the manager books it during setup and it gates nothing, so a '
  'cycle without one is normal.';
