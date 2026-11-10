-- Prefix Open Keep's tables with "open_keep_" so they're easy to tell apart
-- from the Prayer App's and Barker Game's in the shared Supabase project.
--
--   user_entitlements -> open_keep_user_entitlements (table)
--   user_status       -> open_keep_user_status       (view)
--
-- Installed copies of the app still query the old names until they update, so
-- the old names stay as thin views over the new ones. Drop them once most
-- users are on an app version that uses the new names.

-- ---------------------------------------------------------------------------
-- 1. Rename the table and view. Policies, triggers and the user_status view
--    follow the table automatically.
-- ---------------------------------------------------------------------------

alter table public.user_entitlements rename to open_keep_user_entitlements;
alter view public.user_status rename to open_keep_user_status;

-- Constraints (renaming a primary key or unique constraint renames its index too).
alter table public.open_keep_user_entitlements rename constraint "Users_pkey" to open_keep_user_entitlements_pkey;
alter table public.open_keep_user_entitlements rename constraint "Users_user_id_key" to open_keep_user_entitlements_user_id_key;
alter table public.open_keep_user_entitlements rename constraint "Users_user_id_fkey" to open_keep_user_entitlements_user_id_fkey;
alter table public.open_keep_user_entitlements rename constraint user_entitlements_app_check to open_keep_user_entitlements_app_check;
alter index public.user_entitlements_pin_code_key rename to open_keep_user_entitlements_pin_code_key;

-- ---------------------------------------------------------------------------
-- 2. Point the functions at the new name. Function bodies are stored as text,
--    so a table rename doesn't update them. Same signatures, so
--    "create or replace" keeps the existing grants.
-- ---------------------------------------------------------------------------

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.raw_user_meta_data->>'app' = 'Prayer App' then
    insert into public.prayer_user_entitlements (user_id)
    values (new.id)
    on conflict (user_id) do nothing;
  else
    insert into public.open_keep_user_entitlements (user_id, app)
    values (
      new.id,
      case
        when new.raw_user_meta_data->>'app' in ('Open Keep', 'Game')
          then new.raw_user_meta_data->>'app'
      end
    );
  end if;
  return new;
end;
$$;

create or replace function public.record_app_login(p_app text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
begin
  if v_uid is null then
    raise exception 'not signed in';
  end if;
  if p_app is null or p_app not in ('Open Keep', 'Prayer App', 'Game') then
    raise exception 'unknown app: %', p_app;
  end if;

  if p_app = 'Prayer App' then
    insert into public.prayer_user_entitlements (user_id, times_logged_in, last_login)
    values (v_uid, 1, now())
    on conflict (user_id) do update
      set times_logged_in = public.prayer_user_entitlements.times_logged_in + 1,
          last_login = now(),
          updated_at = now();
    return;
  end if;

  insert into public.open_keep_user_entitlements (user_id, app, times_logged_in, last_login)
  values (v_uid, p_app, 1, now())
  on conflict (user_id) do update
    set times_logged_in = coalesce(public.open_keep_user_entitlements.times_logged_in, 0) + 1,
        last_login = now(),
        updated_at = now(),
        app = coalesce(public.open_keep_user_entitlements.app, excluded.app);
end;
$$;

create or replace function public.cleanup_old_users()
returns void
language plpgsql
as $$
declare
  deleted_count int;
begin
  delete from public.open_keep_user_entitlements u
  where coalesce(u.last_login, 'epoch'::timestamptz) < now() - interval '3 months'
    and exists (select 1 from auth.users au where au.id = u.user_id);
  get diagnostics deleted_count = row_count;
  insert into public.cleanup_logs (deleted_count, table_name)
  values (deleted_count, 'open_keep_user_entitlements');

  delete from public.prayer_user_entitlements u
  where coalesce(u.last_login, 'epoch'::timestamptz) < now() - interval '3 months'
    and exists (select 1 from auth.users au where au.id = u.user_id);
  get diagnostics deleted_count = row_count;
  insert into public.cleanup_logs (deleted_count, table_name)
  values (deleted_count, 'prayer_user_entitlements');
end;
$$;

create or replace function public.generate_unique_pin_code()
returns integer
language plpgsql
security definer
set search_path = 'public'
as $$
declare
  new_pin integer;
begin
  loop
    new_pin := floor(random() * 90000 + 10000)::integer;
    exit when not exists (
      select 1
      from public.open_keep_user_entitlements
      where pin_code = new_pin
    );
  end loop;
  return new_pin;
end;
$$;

create or replace function public.verify_user_pin(pin_input text)
returns table (
  found_user_id uuid,
  found_has_access boolean,
  found_paid_start timestamptz,
  found_paid_end timestamptz,
  found_trial_start timestamptz,
  found_trial_end timestamptz,
  found_is_trial boolean
)
language plpgsql
security definer
set search_path = 'public', 'pg_catalog'
as $$
begin
  return query
  select
    ue.user_id as found_user_id,
    true as found_has_access,
    null::timestamptz as found_paid_start,
    null::timestamptz as found_paid_end,
    null::timestamptz as found_trial_start,
    null::timestamptz as found_trial_end,
    false as found_is_trial
  from public.open_keep_user_entitlements ue
  where pin_input ~ '^\d+$'
    and ue.pin_code = pin_input::integer
  limit 1;
end;
$$;

-- ---------------------------------------------------------------------------
-- 3. Old names for installed app versions. security_invoker makes the
--    caller's row level security apply, so each user still only sees and
--    writes their own row. Simple views are updatable, so the old app's
--    select / upsert calls work unchanged.
-- ---------------------------------------------------------------------------

create view public.user_entitlements
with (security_invoker = on)
as select * from public.open_keep_user_entitlements;

create view public.user_status
with (security_invoker = on)
as select * from public.open_keep_user_status;

comment on view public.user_entitlements is
  'Old name kept for Open Keep versions before the open_keep_ prefix. Drop once they are gone.';
comment on view public.user_status is
  'Old name kept for Open Keep versions before the open_keep_ prefix. Drop once they are gone.';

revoke all on public.user_entitlements, public.user_status from anon, authenticated;
grant select, insert, update on public.user_entitlements to anon, authenticated;
grant select on public.user_status to anon, authenticated;

notify pgrst, 'reload schema';
