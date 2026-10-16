-- RLS dongusu duzeltmesi: posts <-> beta_matches politikasi birbirine
-- bakip sonsuz recursion'a giriyordu (girisli kullanicida eser sorgulari patlardi).
-- Donguyu security definer fonksiyonlarla kiriyoruz.

create or replace function public.has_beta_access(pid uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.beta_matches bm
    where bm.post_id = pid and bm.reader_id = (select auth.uid())
  );
$$;
revoke all on function public.has_beta_access(uuid) from public;
grant execute on function public.has_beta_access(uuid) to anon, authenticated;

create or replace function public.is_post_author(pid uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.posts p
    where p.id = pid and p.author_id = (select auth.uid())
  );
$$;
revoke all on function public.is_post_author(uuid) from public;
grant execute on function public.is_post_author(uuid) to anon, authenticated;

create or replace function public.beta_eligible_post(pid uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.posts p
    where p.id = pid and p.beta_wanted = true and p.author_id <> (select auth.uid())
  );
$$;
revoke all on function public.beta_eligible_post(uuid) from public;
grant execute on function public.beta_eligible_post(uuid) to anon, authenticated;

-- posts: taslak gorunurlugu -> definer fonksiyon (beta_matches RLS'i calismaz)
drop policy if exists "Drafts visible only to author" on public.posts;
drop policy if exists "Drafts visible to author and beta readers" on public.posts;
create policy "Drafts visible to author and beta readers" on public.posts
  as restrictive for select to anon, authenticated
  using (
    is_draft = false
    or author_id = auth.uid()
    or public.has_beta_access(id)
  );

-- beta_matches: posts'a dogrudan bakmak yerine definer fonksiyon
drop policy if exists beta_matches_select on public.beta_matches;
create policy beta_matches_select on public.beta_matches
  for select to authenticated
  using (reader_id = auth.uid() or public.is_post_author(post_id));

drop policy if exists beta_matches_insert on public.beta_matches;
create policy beta_matches_insert on public.beta_matches
  for insert to authenticated with check (
    reader_id = auth.uid()
    and public.beta_eligible_post(post_id)
  );

drop policy if exists beta_matches_delete on public.beta_matches;
create policy beta_matches_delete on public.beta_matches
  for delete to authenticated
  using (reader_id = auth.uid() or public.is_post_author(post_id));

notify pgrst, 'reload schema';
