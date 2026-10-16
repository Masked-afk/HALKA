-- Jam odası: topluluk ortak müzik kuyruğu. Üyeler HALKA'daki müzik eserlerini
-- kuyruğa ekler; liste topluluğa ortaktır ve realtime güncellenir.
-- 202610170015_community_collections.sql sonrasinda calistirilir.

create table if not exists public.community_jam_queue (
  community_id uuid not null references public.communities(id) on delete cascade,
  post_id uuid not null references public.posts(id) on delete cascade,
  added_by uuid not null references auth.users(id) on delete cascade,
  position int not null default 0,
  created_at timestamptz not null default now(),
  primary key (community_id, post_id)
);
create index if not exists jam_queue_idx on public.community_jam_queue (community_id, position, created_at);

alter table public.community_jam_queue enable row level security;

-- Yalnızca üyeler kuyruğu görür
drop policy if exists jam_queue_select on public.community_jam_queue;
create policy jam_queue_select on public.community_jam_queue
  for select to authenticated using (
    exists (
      select 1 from public.community_members cm
      where cm.community_id = community_id and cm.user_id = auth.uid()
    )
  );

-- Üye yalnızca müzik eseri ekleyebilir
drop policy if exists jam_queue_insert on public.community_jam_queue;
create policy jam_queue_insert on public.community_jam_queue
  for insert to authenticated with check (
    added_by = auth.uid()
    and exists (
      select 1 from public.posts p
      where p.id = post_id and p.type = 'music'
    )
    and exists (
      select 1 from public.community_members cm
      where cm.community_id = community_id and cm.user_id = auth.uid()
    )
  );

-- Ekleyen üye, admin veya kurucu kaldırabilir
drop policy if exists jam_queue_delete on public.community_jam_queue;
create policy jam_queue_delete on public.community_jam_queue
  for delete to authenticated using (
    added_by = auth.uid()
    or exists (
      select 1 from public.communities c
      where c.id = community_id and c.created_by = auth.uid()
    )
    or exists (
      select 1 from public.community_members cm
      where cm.community_id = community_id and cm.user_id = auth.uid() and cm.role = 'admin'
    )
  );

-- Realtime yayınına ekle
do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    begin execute 'alter publication supabase_realtime add table public.community_jam_queue';
    exception when duplicate_object then null; end;
  end if;
end $$;

notify pgrst, 'reload schema';
