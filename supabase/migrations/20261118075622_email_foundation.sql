-- ============================================================================
-- Migration: email foundation -- settings, config and send log
--
-- The sending foundation for system email. NO trigger hooks and no real email
-- types yet; this migration only creates the three tables the sender needs.
--
-- There is no review queue. Every email type is either off or automatic: the
-- manager decides in advance whether a type sends at all, and once it is on it
-- goes out when the event happens, with no per-message approval step.
--
-- 1. email_settings -- one row per email TYPE, keyed by the catalog key used in
--    lib/email/catalog.ts (e.g. 'researcher_approved'). It carries the
--    manager's switch for that type -- 'off' or 'auto' (send immediately) --
--    plus optional subject/body overrides. A null override means "use the
--    default written in the code", so the catalog stays the single source of
--    the wording until a manager deliberately edits it. reminder_offsets is
--    days-before-deadline and is read only by reminder-kind types. A MISSING
--    ROW MEANS 'off': a new email type added to the catalog sends nothing
--    until a manager turns it on, which is why managers can INSERT here.
--
-- 2. email_config -- single-row table (the `id boolean primary key check (id)`
--    trick makes a second row impossible) for settings that are not per-type.
--    Today that is just the manager's notification address, which is also used
--    as Reply-To on every outgoing message, so a researcher who hits reply
--    reaches a person rather than the no-reply sender.
--
-- 3. email_log -- the record of what the portal has sent. Rows store the
--    RENDERED subject/body as they were (or would have been) sent, so the log
--    stays accurate even after a manager later edits the template.
--    dedupe_key carries a UNIQUE index so a retried action cannot send twice;
--    it is nullable and NULLs do not collide, so un-deduped sends still work.
--    A row is written BEFORE the provider is called, as 'sending', so a send
--    that dies mid-flight still leaves evidence of itself.
--
-- RLS: managers read all three and edit the two settings tables. NOBODY else
-- gets any access -- not researchers, not committee, not anon. email_log is
-- written only by the server using the service-role client, which bypasses RLS
-- entirely, so there is deliberately no insert/update policy on it.
--
-- NO BACKFILL beyond the single email_config row. No existing table is changed.
--
-- Reuses existing functions: public.is_manager(uuid), public.set_updated_at().
-- Does NOT redefine them.
--
-- NOTE: apply by pasting into the Supabase dashboard SQL editor.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. email_settings -- per-type switch and copy overrides
-- ----------------------------------------------------------------------------
create table if not exists public.email_settings (
  key              text primary key,          -- catalog key, e.g. 'system_test'
  mode             text not null default 'off'
                     check (mode in ('off', 'auto')),
  subject_override text,                      -- null = use the code default
  body_override    text,                      -- null = use the code default
  reminder_offsets int[],                     -- days before deadline; reminders only
  updated_at       timestamptz not null default now(),
  updated_by       uuid references auth.users (id) on delete set null
);

comment on table public.email_settings is
  'One row per email type (catalog key). A missing row means mode = off.';
comment on column public.email_settings.mode is
  'off = never send; auto = send when the event happens. There is no review step.';
comment on column public.email_settings.reminder_offsets is
  'Days before the deadline to send, e.g. {14,3}. Read only by reminder-kind types.';

drop trigger if exists trg_email_settings_set_updated_at on public.email_settings;
create trigger trg_email_settings_set_updated_at
  before update on public.email_settings
  for each row
  execute function public.set_updated_at();

-- ----------------------------------------------------------------------------
-- 2. email_config -- single row, non-per-type settings
-- ----------------------------------------------------------------------------
create table if not exists public.email_config (
  id                          boolean primary key default true check (id),
  manager_notification_address text not null,
  updated_at                  timestamptz not null default now(),
  updated_by                  uuid references auth.users (id) on delete set null
);

comment on table public.email_config is
  'Single row (id is always true). Holds settings that are not per email type.';
comment on column public.email_config.manager_notification_address is
  'Where manager-audience email goes, and the Reply-To on every outgoing message.';

drop trigger if exists trg_email_config_set_updated_at on public.email_config;
create trigger trg_email_config_set_updated_at
  before update on public.email_config
  for each row
  execute function public.set_updated_at();

-- The one row. on conflict do nothing so re-running this migration is safe and
-- never overwrites an address the manager has since changed.
insert into public.email_config (id, manager_notification_address)
values (true, 'jtarara@washingtonwine.org')
on conflict (id) do nothing;

-- ----------------------------------------------------------------------------
-- 3. email_log -- record of what has been sent
-- ----------------------------------------------------------------------------
create table if not exists public.email_log (
  id                  uuid primary key default gen_random_uuid(),
  email_key           text not null,
  recipient_email     text not null,
  recipient_user_id   uuid references auth.users (id) on delete set null,
  subject             text not null,          -- rendered, as sent / as it would be
  body                text not null,          -- rendered plain text
  status              text not null
                        check (status in ('sending', 'logged', 'sent', 'failed')),
  dedupe_key          text,
  entity_type         text,                   -- e.g. 'proposal'
  entity_id           uuid,
  error               text,
  provider_message_id text,
  created_at          timestamptz not null default now(),
  sent_at             timestamptz
);

comment on column public.email_log.status is
  'sending = row written and the provider call is in progress (a row left in '
  'sending means the send crashed mid-flight); logged = rendered but '
  'EMAIL_DELIVERY was not live, so nothing left the building; sent; failed.';
comment on column public.email_log.dedupe_key is
  'Optional idempotency key. UNIQUE, but nullable -- NULLs do not collide, so '
  'sends that opt out of deduping still work.';
comment on column public.email_log.entity_type is
  'What the email was about (e.g. proposal), for filtering the log.';

-- Unique so a repeated action cannot produce a second send. Nullable keys are
-- exempt, which is the point.
create unique index if not exists email_log_dedupe_key_idx
  on public.email_log (dedupe_key);

create index if not exists email_log_status_idx     on public.email_log (status);
create index if not exists email_log_key_idx        on public.email_log (email_key);
create index if not exists email_log_entity_idx     on public.email_log (entity_type, entity_id);
create index if not exists email_log_created_at_idx on public.email_log (created_at desc);

-- ----------------------------------------------------------------------------
-- 4. Row Level Security
--    Manager-only. Managers can insert and update email_settings (turning a
--    type on for the first time is an INSERT, since a missing row means off)
--    and update email_config. No delete anywhere: switching a type off is a
--    mode change, not a deletion. The server writes email_log with the
--    service-role client, which bypasses RLS, so no insert/update policy
--    exists here on purpose.
-- ----------------------------------------------------------------------------
grant select, insert, update on public.email_settings to authenticated;
alter table public.email_settings enable row level security;

drop policy if exists "email_settings_select_manager" on public.email_settings;
drop policy if exists "email_settings_insert_manager" on public.email_settings;
drop policy if exists "email_settings_update_manager" on public.email_settings;

create policy "email_settings_select_manager"
  on public.email_settings for select to authenticated
  using (public.is_manager(auth.uid()));

create policy "email_settings_insert_manager"
  on public.email_settings for insert to authenticated
  with check (public.is_manager(auth.uid()));

create policy "email_settings_update_manager"
  on public.email_settings for update to authenticated
  using (public.is_manager(auth.uid()))
  with check (public.is_manager(auth.uid()));

grant select, update on public.email_config to authenticated;
alter table public.email_config enable row level security;

drop policy if exists "email_config_select_manager" on public.email_config;
drop policy if exists "email_config_update_manager" on public.email_config;

create policy "email_config_select_manager"
  on public.email_config for select to authenticated
  using (public.is_manager(auth.uid()));

create policy "email_config_update_manager"
  on public.email_config for update to authenticated
  using (public.is_manager(auth.uid()))
  with check (public.is_manager(auth.uid()));

grant select on public.email_log to authenticated;
alter table public.email_log enable row level security;

drop policy if exists "email_log_select_manager" on public.email_log;

create policy "email_log_select_manager"
  on public.email_log for select to authenticated
  using (public.is_manager(auth.uid()));
