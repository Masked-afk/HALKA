-- Beta okuyucu eslesmesi: yazar "beta okur istiyorum" der, gonullu okur
-- taslağa erisir, okur ve yazara ozel geri bildirim birakir.
-- 202610170026_reading_clubs.sql sonrasinda calistirilir.

alter table public.posts
  add column if not exists beta_wanted boolean not null default false;
create index if not exists posts_beta_idx on public.posts (created_at desc) where beta_wanted;

create table if not exists public.beta_matches (
  id uuid primary key default gen_random_uuid(),
  post_id uuid not null references public.posts(id) on delete cascade,
  reader_id uuid not null references auth.users(id) on delete cascade,
  feedback text check (feedback is null or length(feedback) <= 5000),
  done_at timestamptz,
  created_at timestamptz not null default now(),
  unique (post_id, reader_id)
);
create index if not exists beta_matches_reader_idx on public.beta_matches (reader_id, created_at desc);
create index if not exists beta_matches_post_idx on public.beta_matches (post_id);

alter table public.beta_matches enable row level security;
grant select, insert, update, delete on public.beta_matches to authenticated;

-- Okur kendi eslesmesini, yazar kendi eserinin eslesmelerini gorur
drop policy if exists beta_matches_select on public.beta_matches;
create policy beta_matches_select on public.beta_matches
  for select to authenticated
  using (reader_id = auth.uid() or exists (
    select 1 from public.posts p where p.id = post_id and p.author_id = auth.uid()
  ));

-- Eslesme: girisli, eser beta istiyor, kendi eseri degil
drop policy if exists beta_matches_insert on public.beta_matches;
create policy beta_matches_insert on public.beta_matches
  for insert to authenticated with check (
    reader_id = auth.uid()
    and exists (
      select 1 from public.posts p
      where p.id = post_id and p.beta_wanted = true and p.author_id <> auth.uid()
    )
  );

-- Okur geri bildirim yazar / gorevini bitirir
drop policy if exists beta_matches_update on public.beta_matches;
create policy beta_matches_update on public.beta_matches
  for update to authenticated using (reader_id = auth.uid()) with check (reader_id = auth.uid());

-- Okur ya da yazar eslesmeyi kaldirabilir (yazar okuru dusururse erisim kapanir)
drop policy if exists beta_matches_delete on public.beta_matches;
create policy beta_matches_delete on public.beta_matches
  for delete to authenticated using (
    reader_id = auth.uid() or exists (
      select 1 from public.posts p where p.id = post_id and p.author_id = auth.uid()
    )
  );

-- Eslesmis beta okuru taslagi gorebilir (mevcut restrictive politikayi genislet)
drop policy if exists "Drafts visible only to author" on public.posts;
drop policy if exists "Drafts visible to author and beta readers" on public.posts;
create policy "Drafts visible to author and beta readers" on public.posts
  as restrictive for select to anon, authenticated
  using (
    is_draft = false
    or author_id = auth.uid()
    or exists (
      select 1 from public.beta_matches bm
      where bm.post_id = posts.id and bm.reader_id = auth.uid()
    )
  );

-- Kuyruk sayisi ve eslesme cekimi: taslaklar RLS ile gizli oldugundan
-- aday secimi security definer fonksiyonla yapilir (eser icerigi sizmaz).
create or replace function public.beta_queue_count()
returns int language sql stable security definer set search_path = '' as $$
  select count(*)::int from public.posts p
  where p.beta_wanted = true and p.author_id <> auth.uid()
    and not exists (select 1 from public.beta_matches bm where bm.post_id = p.id and bm.reader_id = auth.uid())
$$;
revoke all on function public.beta_queue_count() from public;
grant execute on function public.beta_queue_count() to authenticated;

create or replace function public.draw_beta_match()
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  v_post uuid;
begin
  if auth.uid() is null then raise exception 'Giris gerekli.' using errcode = '42501'; end if;
  select p.id into v_post from public.posts p
  where p.beta_wanted = true and p.author_id <> auth.uid()
    and not exists (select 1 from public.beta_matches bm where bm.post_id = p.id and bm.reader_id = auth.uid())
  order by random() limit 1;
  if v_post is null then return null; end if;
  insert into public.beta_matches (post_id, reader_id) values (v_post, auth.uid());
  return v_post;
end;
$$;
revoke all on function public.draw_beta_match() from public;
grant execute on function public.draw_beta_match() to authenticated;

notify pgrst, 'reload schema';
