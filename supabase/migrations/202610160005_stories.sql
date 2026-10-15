-- Story / günlük üretim: 24 saat içinde kaybolan hafif paylaşımlar.
-- Süresi dolan story'ler RLS ile otomatik olarak okunamaz hâle gelir.
-- 202610160004_collections.sql sonrasında çalıştırılır.

create table if not exists public.stories (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  image_path text,
  body text not null default '',
  created_at timestamptz not null default now(),
  constraint stories_content check (
    image_path is not null or length(btrim(body)) > 0
  ),
  constraint stories_body_length check (length(body) <= 500),
  constraint stories_image_path check (
    image_path is null or image_path like user_id::text || '/stories/%'
  )
);
create index if not exists stories_user_created_idx
  on public.stories (user_id, created_at desc);

alter table public.stories enable row level security;
grant select, insert, delete on public.stories to anon, authenticated;

drop policy if exists "Active stories are readable" on public.stories;
create policy "Active stories are readable"
  on public.stories for select to anon, authenticated
  using (created_at > now() - interval '24 hours');

drop policy if exists "Users publish own stories" on public.stories;
create policy "Users publish own stories"
  on public.stories for insert to authenticated
  with check (user_id = auth.uid() and created_at > now() - interval '1 minute');

drop policy if exists "Users delete own stories" on public.stories;
create policy "Users delete own stories"
  on public.stories for delete to authenticated
  using (user_id = auth.uid());

notify pgrst, 'reload schema';
