-- Devamini yaz: eser sahibi izin verirse okurlar devam/ikame bolum onerir;
-- sahip onaylarsa bolum olarak yayinlanir (krediyle).
-- 202610170017_post_series.sql sonrasinda calistirilir.

alter table public.posts
  add column if not exists allow_continuation boolean not null default false;

create table if not exists public.post_continuations (
  id uuid primary key default gen_random_uuid(),
  post_id uuid not null references public.posts(id) on delete cascade,
  author_id uuid not null references auth.users(id) on delete cascade,
  title text check (title is null or length(title) <= 120),
  body text not null check (length(btrim(body)) between 1 and 20000),
  status text not null default 'pending' check (status in ('pending','accepted','declined')),
  created_at timestamptz not null default now()
);
create index if not exists post_continuations_idx on public.post_continuations (post_id, status, created_at);
create index if not exists post_continuations_author_idx on public.post_continuations (author_id, created_at desc);

alter table public.post_continuations enable row level security;

-- Görenler: öneren kendisi, eser sahibi, herkes (kabul edilmişler)
drop policy if exists continuations_select on public.post_continuations;
create policy continuations_select on public.post_continuations
  for select using (
    status = 'accepted'
    or author_id = auth.uid()
    or exists (select 1 from public.posts p where p.id = post_id and p.author_id = auth.uid())
  );

-- Öneri: girişli, eser sahibi değil, eser izin veriyor
drop policy if exists continuations_insert on public.post_continuations;
create policy continuations_insert on public.post_continuations
  for insert to authenticated with check (
    author_id = auth.uid()
    and exists (
      select 1 from public.posts p
      where p.id = post_id and p.allow_continuation = true and p.author_id <> auth.uid()
    )
  );

-- Durum değişikliği: yalnızca eser sahibi
drop policy if exists continuations_update on public.post_continuations;
create policy continuations_update on public.post_continuations
  for update to authenticated using (
    exists (select 1 from public.posts p where p.id = post_id and p.author_id = auth.uid())
  );

-- Silme: öneren veya eser sahibi
drop policy if exists continuations_delete on public.post_continuations;
create policy continuations_delete on public.post_continuations
  for delete to authenticated using (
    author_id = auth.uid()
    or exists (select 1 from public.posts p where p.id = post_id and p.author_id = auth.uid())
  );

-- Bildirim turune 'continuation' ekle (kabul haberi icin)
do $$
declare r record;
begin
  for r in
    select conname from pg_constraint c
    join pg_class t on t.oid = c.conrelid
    join pg_namespace n on n.oid = t.relnamespace
    where n.nspname = 'public' and t.relname = 'notifications' and c.contype = 'c'
      and pg_get_constraintdef(c.oid) ilike '%friend_accept%'
  loop
    execute format('alter table public.notifications drop constraint %I', r.conname);
  end loop;
  alter table public.notifications add constraint notifications_type_check
    check (type in ('like','comment','reply','friend_request','friend_accept','message','follow','badge','new_post','relay','continuation')) not valid;
end $$;
alter table public.notifications validate constraint notifications_type_check;

notify pgrst, 'reload schema';
