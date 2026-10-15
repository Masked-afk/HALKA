-- Kullanıcının kendi hesabını kalıcı olarak silmesi.
-- auth.users satırı silinince profiles, posts, friend_requests, blocks vb.
-- "on delete cascade" bağlı tüm kayıtlar da otomatik silinir.
create or replace function public.delete_own_account()
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null then
    raise exception 'not authenticated';
  end if;
  delete from auth.users where id = auth.uid();
end;
$$;

revoke all on function public.delete_own_account() from public;
grant execute on function public.delete_own_account() to authenticated;

notify pgrst, 'reload schema';
