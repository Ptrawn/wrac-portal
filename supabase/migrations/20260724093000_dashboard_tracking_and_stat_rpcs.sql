-- ============================================================================
-- Migration: dashboard "since last login" tracking + stat RPCs
-- The manager and committee landing pages are becoming stat tiles. One tile
-- shows proposals submitted since the manager's PREVIOUS login. auth.users
-- .last_sign_in_at is already the current session by the time we read it, so we
-- store the prior value ourselves on profiles and compare against it.
--
-- "Open" cycles = status NOT IN ('setup','closed').
--
-- Reuses existing functions: public.is_manager(uuid), public.is_committee(uuid).
-- Does NOT redefine them.
--
-- NOTE on the self-elevation guard: prevent_profile_self_elevation only raises
-- when role or status CHANGES. touch_last_seen writes only previous_seen_at and
-- last_seen_at, so the guard is not triggered -- a normal researcher/committee/
-- manager can advance their own timestamps without manager privilege.
--
-- NOTE: apply by pasting into the Supabase dashboard SQL editor.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. Tracking columns on profiles
-- ----------------------------------------------------------------------------
alter table public.profiles
  add column if not exists previous_seen_at timestamptz;
alter table public.profiles
  add column if not exists last_seen_at timestamptz;

-- ----------------------------------------------------------------------------
-- 2. touch_last_seen() -- record a dashboard visit for the calling user.
--    Copies last_seen_at into previous_seen_at, then sets last_seen_at = now().
--    Throttled: only advances when last_seen_at is null or older than 10 minutes,
--    so rapid refreshes keep the same "since last login" window.
-- ----------------------------------------------------------------------------
create or replace function public.touch_last_seen()
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid  uuid := auth.uid();
  v_last timestamptz;
begin
  if v_uid is null then
    raise exception 'Not authenticated' using errcode = '42501';
  end if;

  select last_seen_at into v_last
  from public.profiles
  where id = v_uid
  for update;

  if v_last is null or v_last < now() - interval '10 minutes' then
    update public.profiles
    set previous_seen_at = last_seen_at,
        last_seen_at = now()
    where id = v_uid;
  end if;
end;
$$;

revoke all on function public.touch_last_seen() from public, anon;
grant execute on function public.touch_last_seen() to authenticated;

-- ----------------------------------------------------------------------------
-- 3. manager_dashboard_stats() -- headline numbers across open cycles.
-- ----------------------------------------------------------------------------
create or replace function public.manager_dashboard_stats()
returns table (
  open_cycle_count            int,
  pending_registration_count  int,
  committee_member_count      int,
  submissions_since_last_seen int,
  total_submitted_open        int
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_prev timestamptz;
begin
  if not public.is_manager(auth.uid()) then
    raise exception 'Only a manager may view dashboard stats' using errcode = '42501';
  end if;

  select previous_seen_at into v_prev
  from public.profiles
  where id = auth.uid();

  return query
  select
    (select count(*) from public.cycles c
       where c.status not in ('setup', 'closed'))::int,
    (select count(*) from public.profiles p
       where p.role = 'researcher' and p.status = 'pending')::int,
    (select count(*) from public.profiles p
       where p.role = 'committee' and p.status = 'approved')::int,
    -- submitted since previous login (0 when previous_seen_at is null)
    (select count(*) from public.proposals pr
       join public.cycles c on c.id = pr.cycle_id
      where c.status not in ('setup', 'closed')
        and pr.submitted_at is not null
        and v_prev is not null
        and pr.submitted_at > v_prev)::int,
    (select count(*) from public.proposals pr
       join public.cycles c on c.id = pr.cycle_id
      where c.status not in ('setup', 'closed')
        and pr.state = 'submitted')::int;
end;
$$;

revoke all on function public.manager_dashboard_stats() from public, anon;
grant execute on function public.manager_dashboard_stats() to authenticated;

-- ----------------------------------------------------------------------------
-- 4. cycle_tiles_for_manager() -- one row per non-closed cycle.
-- ----------------------------------------------------------------------------
create or replace function public.cycle_tiles_for_manager()
returns table (
  cycle_id            uuid,
  name                text,
  year                int,
  status              text,
  next_deadline       date,
  next_deadline_label text,
  submitted_count     int,
  funded_count        int
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not public.is_manager(auth.uid()) then
    raise exception 'Only a manager may view cycle tiles' using errcode = '42501';
  end if;

  return query
  select
    c.id,
    c.name,
    c.year,
    c.status,
    case c.status
      when 'pre_proposal_open' then c.pre_proposal_closes_at
      when 'pre_review'        then c.pre_review_due_at
      when 'full_proposal_open' then c.full_proposal_due_at
      when 'full_review'       then c.full_review_due_at
      else null
    end as next_deadline,
    case c.status
      when 'pre_proposal_open' then 'Pre-proposals close'
      when 'pre_review'        then 'Pre-reviews due'
      when 'full_proposal_open' then 'Full proposals due'
      when 'full_review'       then 'Full reviews due'
      else null
    end as next_deadline_label,
    (select count(*) from public.proposals pr
       where pr.cycle_id = c.id and pr.state = 'submitted')::int,
    (select count(*) from public.proposals pr
       where pr.cycle_id = c.id and pr.outcome = 'funded')::int
  from public.cycles c
  where c.status <> 'closed'
  order by c.year desc;
end;
$$;

revoke all on function public.cycle_tiles_for_manager() from public, anon;
grant execute on function public.cycle_tiles_for_manager() to authenticated;

-- ----------------------------------------------------------------------------
-- 5a. committee_review_progress() -- aggregate outstanding review load.
--     expected = (submitted proposals in open cycles) × (approved committee).
--     submitted_reviews counts submitted reviews BY APPROVED COMMITTEE members
--     on those proposals, so the aggregate matches the per-member breakdown.
-- ----------------------------------------------------------------------------
create or replace function public.committee_review_progress()
returns table (
  expected_reviews    int,
  submitted_reviews   int,
  outstanding_reviews int
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_proposals int;
  v_members   int;
  v_submitted int;
  v_expected  int;
begin
  if not public.is_manager(auth.uid()) then
    raise exception 'Only a manager may view review progress' using errcode = '42501';
  end if;

  select count(*) into v_proposals
  from public.proposals pr
  join public.cycles c on c.id = pr.cycle_id
  where c.status not in ('setup', 'closed')
    and pr.state = 'submitted';

  select count(*) into v_members
  from public.profiles p
  where p.role = 'committee' and p.status = 'approved';

  select count(*) into v_submitted
  from public.reviews rv
  join public.proposals pr on pr.id = rv.proposal_id
  join public.cycles c on c.id = pr.cycle_id
  join public.profiles pm on pm.id = rv.reviewer_id
  where c.status not in ('setup', 'closed')
    and pr.state = 'submitted'
    and rv.state = 'submitted'
    and pm.role = 'committee'
    and pm.status = 'approved';

  v_expected := v_proposals * v_members;

  return query
  select v_expected, v_submitted, greatest(v_expected - v_submitted, 0);
end;
$$;

revoke all on function public.committee_review_progress() from public, anon;
grant execute on function public.committee_review_progress() to authenticated;

-- ----------------------------------------------------------------------------
-- 5b. committee_member_review_status() -- per-member outstanding breakdown.
--     All members review all submitted proposals, so assigned_count is the same
--     total for each member.
-- ----------------------------------------------------------------------------
create or replace function public.committee_member_review_status()
returns table (
  reviewer_id      uuid,
  reviewer_name    text,
  assigned_count   int,
  submitted_count  int,
  outstanding_count int
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_assigned int;
begin
  if not public.is_manager(auth.uid()) then
    raise exception 'Only a manager may view committee review status'
      using errcode = '42501';
  end if;

  select count(*) into v_assigned
  from public.proposals pr
  join public.cycles c on c.id = pr.cycle_id
  where c.status not in ('setup', 'closed')
    and pr.state = 'submitted';

  return query
  select
    p.id,
    p.full_name,
    v_assigned::int,
    sub.submitted_count::int,
    greatest(v_assigned - sub.submitted_count, 0)::int
  from public.profiles p
  cross join lateral (
    select count(*) as submitted_count
    from public.reviews rv
    join public.proposals pr on pr.id = rv.proposal_id
    join public.cycles c on c.id = pr.cycle_id
    where c.status not in ('setup', 'closed')
      and pr.state = 'submitted'
      and rv.reviewer_id = p.id
      and rv.state = 'submitted'
  ) sub
  where p.role = 'committee' and p.status = 'approved'
  order by greatest(v_assigned - sub.submitted_count, 0) desc;
end;
$$;

revoke all on function public.committee_member_review_status() from public, anon;
grant execute on function public.committee_member_review_status() to authenticated;

-- ----------------------------------------------------------------------------
-- 6. committee_dashboard() -- the committee member's own landing page.
--    One row per open cycle that has proposals visible to committee (submitted
--    proposals; open cycles are out of setup so all submitted proposals are
--    committee-visible).
-- ----------------------------------------------------------------------------
create or replace function public.committee_dashboard()
returns table (
  cycle_id              uuid,
  name                  text,
  status                text,
  review_deadline       date,
  review_deadline_label text,
  proposals_to_review   int,
  my_reviews_submitted  int,
  my_reviews_outstanding int
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
begin
  if not public.is_committee(v_uid) then
    raise exception 'Only a committee member may view the committee dashboard'
      using errcode = '42501';
  end if;

  return query
  with cyc as (
    select
      c.id,
      c.name,
      c.status,
      c.pre_review_due_at,
      c.full_review_due_at,
      (select count(*) from public.proposals pr
         where pr.cycle_id = c.id and pr.state = 'submitted')::int as ptr,
      (select count(*) from public.reviews rv
         join public.proposals pr on pr.id = rv.proposal_id
        where pr.cycle_id = c.id
          and pr.state = 'submitted'
          and rv.reviewer_id = v_uid
          and rv.state = 'submitted')::int as mine
    from public.cycles c
    where c.status not in ('setup', 'closed')
  )
  select
    cyc.id,
    cyc.name,
    cyc.status,
    case cyc.status
      when 'pre_review'        then cyc.pre_review_due_at
      when 'full_review'       then cyc.full_review_due_at
      when 'full_proposal_open' then cyc.full_review_due_at
      else coalesce(cyc.pre_review_due_at, cyc.full_review_due_at)
    end as review_deadline,
    case cyc.status
      when 'pre_review'        then 'Pre-reviews due'
      when 'full_review'       then 'Full reviews due'
      when 'full_proposal_open' then 'Full reviews due'
      else 'Reviews due'
    end as review_deadline_label,
    cyc.ptr,
    cyc.mine,
    greatest(cyc.ptr - cyc.mine, 0)::int
  from cyc
  where cyc.ptr > 0
  order by review_deadline nulls last;
end;
$$;

revoke all on function public.committee_dashboard() from public, anon;
grant execute on function public.committee_dashboard() to authenticated;
