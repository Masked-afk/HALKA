-- Ensure profiles table has RLS and automatic profile creation for all sign-up methods.
alter table public.profiles enable row level security;

grant select, insert, update on public.profiles to authenticated;
revoke delete on public.profiles from authenticated;

drop policy if exists "Profiles are viewable by owner or public profiles" on public.profiles;
create policy "Profiles are viewable by owner or public profiles"
  on public.profiles for select to authenticated
  using (
    id = auth.uid()
    or profile_visibility = 'public'
    or public.can_view_profile(id)
  );

drop policy if exists "Users can insert own profile" on public.profiles;
create policy "Users can insert own profile"
  on public.profiles for insert to authenticated
  with check (id = auth.uid());

drop policy if exists "Users can update own profile" on public.profiles;
create policy "Users can update own profile"
  on public.profiles for update to authenticated
  using (id = auth.uid())
  with check (id = auth.uid());

create or replace function public.handle_new_user_profile()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  base_username text;
  final_username text;
  display_name text;
  counter int := 0;
  max_attempts int := 20;
begin
  if exists (select 1 from public.profiles where id = new.id) then
    return new;
  end if;

  base_username := lower(regexp_replace(coalesce(new.raw_user_meta_data->>'username', split_part(new.email, '@', 1), 'user'), '[^a-z0-9_]', '', 'g'));
  if length(base_username) < 3 then
    base_username := 'user';
  end if;
  final_username := base_username;

  while exists (select 1 from public.profiles where username = final_username) and counter < max_attempts loop
    counter := counter + 1;
    final_username := base_username || '_' || counter::text;
  end loop;

  display_name := coalesce(new.raw_user_meta_data->>'display_name', new.raw_user_meta_data->>'full_name', new.raw_user_meta_data->>'name', split_part(new.email, '@', 1), 'Halka kullanıcısı');

  insert into public.profiles (
    id,
    username,
    display_name,
    accepted_terms_version,
    accepted_privacy_version,
    accepted_community_version
  ) values (
    new.id,
    final_username,
    display_name,
    coalesce(new.raw_user_meta_data->>'terms_version', '2026-10-11-v1'),
    coalesce(new.raw_user_meta_data->>'privacy_version', '2026-10-11-v1'),
    coalesce(new.raw_user_meta_data->>'community_rules_version', '2026-10-11-v1')
  )
  on conflict (id) do nothing;

  return new;
end;
$$;

drop trigger if exists on_auth_user_created_create_profile on auth.users;
create trigger on_auth_user_created_create_profile
  after insert on auth.users
  for each row execute function public.handle_new_user_profile();

revoke all on function public.handle_new_user_profile() from public, anon, authenticated;
grant execute on function public.handle_new_user_profile() to supabase_auth_admin;

notify pgrst, 'reload schema';
