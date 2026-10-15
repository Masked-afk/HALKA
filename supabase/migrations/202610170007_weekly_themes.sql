-- Haftalık tema meydan okuması: admin tema açar, kullanıcılar eserlerini o
-- temayla işaretleyebilir. Eser tarafında posts.theme_id tutulur.
-- 202610170006_paragraph_comments.sql sonrasında çalıştırılır.

create table if not exists public.weekly_themes (
  id uuid primary key default gen_random_uuid(),
  title text not null check (length(btrim(title)) between 2 and 80),
  prompt text check (length(prompt) <= 300),
  starts_on date not null,
  ends_on date not null,
  active boolean not null default true,
  created_at timestamptz not null default now()
);
create index if not exists weekly_themes_active_idx on public.weekly_themes (active, starts_on desc);

alter table public.posts
  add column if not exists theme_id uuid references public.weekly_themes(id) on delete set null;
create index if not exists posts_theme_idx on public.posts (theme_id) where theme_id is not null;

alter table public.weekly_themes enable row level security;

drop policy if exists weekly_themes_select on public.weekly_themes;
create policy weekly_themes_select on public.weekly_themes
  for select to anon, authenticated using (true);

-- Temaları yalnızca adminler açar/kapatır (profiles.is_admin kontrolü RPC üzerinden).
drop policy if exists weekly_themes_admin_write on public.weekly_themes;
create policy weekly_themes_admin_write on public.weekly_themes
  for insert to authenticated
  with check (exists (select 1 from public.profiles where id = auth.uid() and is_admin = true));

drop policy if exists weekly_themes_admin_update on public.weekly_themes;
create policy weekly_themes_admin_update on public.weekly_themes
  for update to authenticated
  using (exists (select 1 from public.profiles where id = auth.uid() and is_admin = true));

notify pgrst, 'reload schema';
