-- Seriler: yazar birbirine bagli eserleri seri altinda gruplar
-- (orn. ayni evrendeki kisa hikayeler, bölümlü evrenler).
-- 202610170016_jam_queue.sql sonrasinda calistirilir.

create table if not exists public.post_series (
  id uuid primary key default gen_random_uuid(),
  author_id uuid not null references auth.users(id) on delete cascade,
  title text not null check (length(btrim(title)) between 1 and 120),
  description text check (description is null or length(description) <= 600),
  created_at timestamptz not null default now()
);
create index if not exists post_series_author_idx on public.post_series (author_id, created_at desc);

create table if not exists public.series_items (
  series_id uuid not null references public.post_series(id) on delete cascade,
  post_id uuid not null references public.posts(id) on delete cascade,
  position int not null default 0,
  added_at timestamptz not null default now(),
  primary key (series_id, post_id)
);
create index if not exists series_items_post_idx on public.series_items (post_id);

alter table public.post_series enable row level security;
alter table public.series_items enable row level security;

-- Seriler herkese açık okunur
drop policy if exists post_series_select on public.post_series;
create policy post_series_select on public.post_series for select using (true);
drop policy if exists series_items_select on public.series_items;
create policy series_items_select on public.series_items for select using (true);

-- Yalnızca seri sahibi yazar
drop policy if exists post_series_insert on public.post_series;
create policy post_series_insert on public.post_series
  for insert to authenticated with check (author_id = auth.uid());
drop policy if exists post_series_update on public.post_series;
create policy post_series_update on public.post_series
  for update to authenticated using (author_id = auth.uid());
drop policy if exists post_series_delete on public.post_series;
create policy post_series_delete on public.post_series
  for delete to authenticated using (author_id = auth.uid());

-- Seri öğesi: hem seri sahibi hem eser sahibi olmalı (kendi eserini kendi serisine)
drop policy if exists series_items_insert on public.series_items;
create policy series_items_insert on public.series_items
  for insert to authenticated with check (
    exists (select 1 from public.post_series s where s.id = series_id and s.author_id = auth.uid())
    and exists (select 1 from public.posts p where p.id = post_id and p.author_id = auth.uid())
  );
drop policy if exists series_items_update on public.series_items;
create policy series_items_update on public.series_items
  for update to authenticated using (
    exists (select 1 from public.post_series s where s.id = series_id and s.author_id = auth.uid())
  );
drop policy if exists series_items_delete on public.series_items;
create policy series_items_delete on public.series_items
  for delete to authenticated using (
    exists (select 1 from public.post_series s where s.id = series_id and s.author_id = auth.uid())
    or exists (select 1 from public.posts p where p.id = post_id and p.author_id = auth.uid())
  );

notify pgrst, 'reload schema';
