-- Beta daveti: yazar sectigi kullaniciya beta erisimi verir.
-- expires_at null => "eser yayinlanana kadar" (yayinlaninca zaten herkese acik).
-- invited => gonullu cekim degil yazar daveti.
-- 202610170030_rls_recursion_fix.sql sonrasinda calistirilir.

alter table public.beta_matches
  add column if not exists invited boolean not null default false,
  add column if not exists expires_at timestamptz;

-- Erisim: eslesme var, suresi gecmemis (null = yayinlanana dek)
create or replace function public.has_beta_access(pid uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.beta_matches bm
    where bm.post_id = pid and bm.reader_id = (select auth.uid())
      and (bm.expires_at is null or bm.expires_at > now())
  );
$$;
revoke all on function public.has_beta_access(uuid) from public;
grant execute on function public.has_beta_access(uuid) to anon, authenticated;

-- Insert: gonullu kendini ekler VEYA yazar baskasini davet eder
drop policy if exists beta_matches_insert on public.beta_matches;
create policy beta_matches_insert on public.beta_matches
  for insert to authenticated with check (
    (reader_id = auth.uid() and public.beta_eligible_post(post_id))
    or (public.is_post_author(post_id) and reader_id <> auth.uid() and invited = true)
  );

-- Bildirim turu: beta daveti
alter table public.notifications drop constraint if exists notifications_type_check;
alter table public.notifications add constraint notifications_type_check
  check (type in ('like','comment','reply','friend_request','friend_accept','message','follow','badge','new_post','relay','continuation','beta_invite'));

notify pgrst, 'reload schema';
