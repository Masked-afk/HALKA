-- HALKA profile customization and opt-in MFA enforcement.
-- Apply this migration after 202610110003_legal_profile_privacy.sql.

alter table public.profiles
  add column if not exists avatar_path text,
  add column if not exists cover_path text,
  add column if not exists profile_visibility text not null default 'public',
  add column if not exists stats_visibility text not null default 'public',
  add column if not exists profile_accent text not null default '#d9b978',
  add column if not exists profile_layout text not null default 'standard';

alter table public.posts
  add column if not exists tags text[] not null default '{}';

alter table public.profiles drop constraint if exists profiles_profile_accent_check;
alter table public.profiles add constraint profiles_profile_accent_check
  check (profile_accent ~ '^#[0-9A-Fa-f]{6}$');

alter table public.profiles drop constraint if exists profiles_profile_visibility_check;
alter table public.profiles add constraint profiles_profile_visibility_check
  check (profile_visibility in ('public', 'private'));

alter table public.profiles drop constraint if exists profiles_stats_visibility_check;
alter table public.profiles add constraint profiles_stats_visibility_check
  check (stats_visibility in ('public', 'private'));

alter table public.profiles drop constraint if exists profiles_profile_layout_check;
alter table public.profiles add constraint profiles_profile_layout_check
  check (profile_layout in ('standard', 'compact', 'showcase'));

-- SECURITY DEFINER keeps authenticated clients from needing direct access to auth.mfa_factors.
create or replace function public.mfa_session_is_valid()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce((select auth.jwt()->>'aal'), 'aal1') = 'aal2'
    or not exists (
      select 1 from auth.mfa_factors f
      where f.user_id = (select auth.uid()) and f.status = 'verified'
    );
$$;
revoke all on function public.mfa_session_is_valid() from public;
grant execute on function public.mfa_session_is_valid() to authenticated;

-- Users who enroll a verified MFA factor must reach AAL2 before using app data.
do $$
declare
  table_name text;
  protected_tables text[] := array[
    'profiles', 'posts', 'chapters', 'comments', 'likes', 'comment_likes',
    'conversations', 'conversation_members', 'messages', 'legal_acceptances'
  ];
  mfa_rule text := 'public.mfa_session_is_valid()';
begin
  foreach table_name in array protected_tables loop
    if to_regclass(format('public.%I', table_name)) is not null then
      execute format('drop policy if exists %I on public.%I', 'Require MFA for opted-in accounts', table_name);
      execute format(
        'create policy %I on public.%I as restrictive for all to authenticated using (%s) with check (%s)',
        'Require MFA for opted-in accounts', table_name, mfa_rule, mfa_rule
      );
    end if;
  end loop;
end $$;

drop policy if exists "Require MFA for opted-in accounts" on storage.objects;
create policy "Require MFA for opted-in accounts" on storage.objects
  as restrictive for all to authenticated
  using (public.mfa_session_is_valid())
  with check (public.mfa_session_is_valid());

notify pgrst, 'reload schema';
