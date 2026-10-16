-- Karakter sözlüğü: eser sahibi karakter isimleri ve kısa bilgiler ekler,
-- okuyucular eser sayfasında görür. Başta light novel için tasarlandı ama
-- tüm bölümlü yazı türlerinde (kitap, story, manga) kullanılabilir.
-- 202610170013_allow_download.sql sonrasında çalıştırılır.

create table if not exists public.post_characters (
  id uuid primary key default gen_random_uuid(),
  post_id uuid not null references public.posts(id) on delete cascade,
  name text not null check (length(btrim(name)) between 1 and 80),
  info text check (info is null or length(info) <= 400),
  position int not null default 0,
  created_at timestamptz not null default now()
);
create index if not exists post_characters_post_idx on public.post_characters (post_id, position);

alter table public.post_characters enable row level security;

-- Herkes okuyabilir (eser sayfasındaki herkese açık üstveri gibi)
drop policy if exists post_characters_select on public.post_characters;
create policy post_characters_select on public.post_characters
  for select using (true);

-- Yalnızca eser sahibi yazar/düzenler/siler
drop policy if exists post_characters_insert on public.post_characters;
create policy post_characters_insert on public.post_characters
  for insert to authenticated
  with check (exists (
    select 1 from public.posts p
    where p.id = post_id and p.author_id = auth.uid()
  ));

drop policy if exists post_characters_update on public.post_characters;
create policy post_characters_update on public.post_characters
  for update to authenticated
  using (exists (
    select 1 from public.posts p
    where p.id = post_id and p.author_id = auth.uid()
  ));

drop policy if exists post_characters_delete on public.post_characters;
create policy post_characters_delete on public.post_characters
  for delete to authenticated
  using (exists (
    select 1 from public.posts p
    where p.id = post_id and p.author_id = auth.uid()
  ));

notify pgrst, 'reload schema';
