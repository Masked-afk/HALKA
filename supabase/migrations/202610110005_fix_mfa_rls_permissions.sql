-- Fix MFA RLS checks without granting clients access to auth.mfa_factors.

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

do $$
declare
  table_name text;
  protected_tables text[] := array[
    'profiles', 'posts', 'chapters', 'comments', 'likes', 'comment_likes',
    'conversations', 'conversation_members', 'messages', 'legal_acceptances'
  ];
begin
  foreach table_name in array protected_tables loop
    if to_regclass(format('public.%I', table_name)) is not null then
      execute format('drop policy if exists %I on public.%I', 'Require MFA for opted-in accounts', table_name);
      execute format(
        'create policy %I on public.%I as restrictive for all to authenticated using (public.mfa_session_is_valid()) with check (public.mfa_session_is_valid())',
        'Require MFA for opted-in accounts', table_name
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
