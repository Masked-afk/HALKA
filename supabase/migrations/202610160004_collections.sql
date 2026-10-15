-- Koleksiyonlar: kaydedilen eserleri isimli listelere ayırma.
-- Listeler sahibine özeldir (RLS).
-- 202610160003_chapter_comments.sql sonrasında çalıştırılır.

create table if not exists public.collections (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  name text not null check (length(btrim(name)) between 1 and 60),
  created_at timestamptz not null default now()
);
create unique index if not exists collections_name_unique
  on public.collections (user_id, lower(name));

create table if not exists public.collection_items (
  collection_id uuid not null references public.collections(id) on delete cascade,
  post_id uuid not null references public.posts(id) on delete cascade,
  added_at timestamptz not null default now(),
  primary key (collection_id, post_id)
);
create index if not exists collection_items_collection_idx
  on public.collection_items (collection_id, added_at desc);

alter table public.collections enable row level security;
alter table public.collection_items enable row level security;
grant select, insert, update, delete on public.collections to authenticated;
grant select, insert, delete on public.collection_items to authenticated;

drop policy if exists "Users manage own collections" on public.collections;
create policy "Users manage own collections"
  on public.collections for all to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

drop policy if exists "Users read own collection items" on public.collection_items;
create policy "Users read own collection items"
  on public.collection_items for select to authenticated
  using (exists (
    select 1 from public.collections c
    where c.id = collection_id and c.user_id = auth.uid()
  ));

drop policy if exists "Users write own collection items" on public.collection_items;
create policy "Users write own collection items"
  on public.collection_items for insert to authenticated
  with check (exists (
    select 1 from public.collections c
    where c.id = collection_id and c.user_id = auth.uid()
  ));

drop policy if exists "Users delete own collection items" on public.collection_items;
create policy "Users delete own collection items"
  on public.collection_items for delete to authenticated
  using (exists (
    select 1 from public.collections c
    where c.id = collection_id and c.user_id = auth.uid()
  ));

notify pgrst, 'reload schema';
