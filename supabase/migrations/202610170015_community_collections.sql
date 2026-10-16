-- Kolektif yayinlar (dergi/albüm): topluluklar ortak yayin cikarir.
-- Üyeler kendi eserlerini gönderir (pending), yöneticiler onaylar (approved),
-- yayin 'draft' iken sadece üyeler görür, 'published' olunca herkes görür.
-- 202610170014_post_characters.sql sonrasinda calistirilir.

create table if not exists public.community_collections (
  id uuid primary key default gen_random_uuid(),
  community_id uuid not null references public.communities(id) on delete cascade,
  title text not null check (length(btrim(title)) between 1 and 120),
  description text check (description is null or length(description) <= 800),
  issue_no int check (issue_no is null or issue_no between 1 and 999),
  status text not null default 'draft' check (status in ('draft','published')),
  created_by uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  published_at timestamptz
);
create index if not exists community_collections_idx on public.community_collections (community_id, created_at desc);

create table if not exists public.community_collection_items (
  collection_id uuid not null references public.community_collections(id) on delete cascade,
  post_id uuid not null references public.posts(id) on delete cascade,
  added_by uuid not null references auth.users(id) on delete cascade,
  status text not null default 'pending' check (status in ('pending','approved')),
  position int not null default 0,
  created_at timestamptz not null default now(),
  primary key (collection_id, post_id)
);
create index if not exists collection_items_status_idx on public.community_collection_items (collection_id, status, position);

alter table public.community_collections enable row level security;
alter table public.community_collection_items enable row level security;

-- Yayinlar: published herkes görür, draft sadece üyeler
drop policy if exists community_collections_select on public.community_collections;
create policy community_collections_select on public.community_collections
  for select using (
    status = 'published'
    or exists (
      select 1 from public.community_members cm
      where cm.community_id = community_id and cm.user_id = auth.uid()
    )
  );

-- Yayin yönetimi: topluluk kurucusu veya admin üyeler
drop policy if exists community_collections_insert on public.community_collections;
create policy community_collections_insert on public.community_collections
  for insert to authenticated with check (
    exists (
      select 1 from public.communities c
      where c.id = community_id and c.created_by = auth.uid()
    ) or exists (
      select 1 from public.community_members cm
      where cm.community_id = community_id and cm.user_id = auth.uid() and cm.role = 'admin'
    )
  );

drop policy if exists community_collections_update on public.community_collections;
create policy community_collections_update on public.community_collections
  for update to authenticated using (
    exists (
      select 1 from public.communities c
      where c.id = community_id and c.created_by = auth.uid()
    ) or exists (
      select 1 from public.community_members cm
      where cm.community_id = community_id and cm.user_id = auth.uid() and cm.role = 'admin'
    )
  );

drop policy if exists community_collections_delete on public.community_collections;
create policy community_collections_delete on public.community_collections
  for delete to authenticated using (
    exists (
      select 1 from public.communities c
      where c.id = community_id and c.created_by = auth.uid()
    ) or exists (
      select 1 from public.community_members cm
      where cm.community_id = community_id and cm.user_id = auth.uid() and cm.role = 'admin'
    )
  );

-- Öğeler: yayindaki koleksiyonun onayli öğeleri herkese açık;
-- üyeler topluluklarinin koleksiyonlarindaki tüm öğeleri görür.
drop policy if exists collection_items_select on public.community_collection_items;
create policy collection_items_select on public.community_collection_items
  for select using (
    exists (
      select 1 from public.community_collections cc
      where cc.id = collection_id and cc.status = 'published'
    ) or exists (
      select 1 from public.community_collections cc
      join public.community_members cm on cm.community_id = cc.community_id
      where cc.id = collection_id and cm.user_id = auth.uid()
    )
  );

-- Üye kendi eserini gönderebilir
drop policy if exists collection_items_insert on public.community_collection_items;
create policy collection_items_insert on public.community_collection_items
  for insert to authenticated with check (
    added_by = auth.uid()
    and exists (
      select 1 from public.posts p
      where p.id = post_id and p.author_id = auth.uid()
    )
    and exists (
      select 1 from public.community_collections cc
      join public.community_members cm on cm.community_id = cc.community_id
      where cc.id = collection_id and cm.user_id = auth.uid()
    )
  );

-- Admin onaylar / sıralar
drop policy if exists collection_items_update on public.community_collection_items;
create policy collection_items_update on public.community_collection_items
  for update to authenticated using (
    exists (
      select 1 from public.community_collections cc
      join public.communities c on c.id = cc.community_id
      where cc.id = collection_id and c.created_by = auth.uid()
    ) or exists (
      select 1 from public.community_collections cc
      join public.community_members cm on cm.community_id = cc.community_id
      where cc.id = collection_id and cm.user_id = auth.uid() and cm.role = 'admin'
    )
  );

-- Admin veya öğeyi gönderen üye silebilir
drop policy if exists collection_items_delete on public.community_collection_items;
create policy collection_items_delete on public.community_collection_items
  for delete to authenticated using (
    added_by = auth.uid()
    or exists (
      select 1 from public.community_collections cc
      join public.communities c on c.id = cc.community_id
      where cc.id = collection_id and c.created_by = auth.uid()
    ) or exists (
      select 1 from public.community_collections cc
      join public.community_members cm on cm.community_id = cc.community_id
      where cc.id = collection_id and cm.user_id = auth.uid() and cm.role = 'admin'
    )
  );

notify pgrst, 'reload schema';
