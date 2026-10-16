-- Okuma listesi paylaşımı: koleksiyonlar herkese açık hâle getirilebilir,
-- başkaları #/liste/ üzerinden gezip takip edebilir.
-- 202610170018_continuations.sql sonrasında çalıştırılır.

alter table public.collections
  add column if not exists is_public boolean not null default false,
  add column if not exists description text check (description is null or length(description) <= 300);

create table if not exists public.collection_follows (
  collection_id uuid not null references public.collections(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (collection_id, user_id)
);
create index if not exists collection_follows_user_idx on public.collection_follows (user_id, created_at desc);

alter table public.collection_follows enable row level security;
grant select, insert, delete on public.collection_follows to authenticated;

-- Herkese açık koleksiyonları herkes okuyabilir (özel olanlar hâlâ sahibine)
drop policy if exists "Public read shared collections" on public.collections;
create policy "Public read shared collections"
  on public.collections for select
  using (is_public = true);

-- Herkese açık koleksiyonun öğeleri de herkese açık
drop policy if exists "Public read shared collection items" on public.collection_items;
create policy "Public read shared collection items"
  on public.collection_items for select
  using (exists (
    select 1 from public.collections c
    where c.id = collection_id and c.is_public = true
  ));

-- Takip: herkes görebilir, girişli kullanıcı ekler/siler
drop policy if exists collection_follows_select on public.collection_follows;
create policy collection_follows_select on public.collection_follows
  for select using (true);

drop policy if exists collection_follows_insert on public.collection_follows;
create policy collection_follows_insert on public.collection_follows
  for insert to authenticated with check (
    user_id = auth.uid()
    and exists (select 1 from public.collections c where c.id = collection_id and c.is_public = true and c.user_id <> auth.uid())
  );

drop policy if exists collection_follows_delete on public.collection_follows;
create policy collection_follows_delete on public.collection_follows
  for delete to authenticated using (user_id = auth.uid());

notify pgrst, 'reload schema';
