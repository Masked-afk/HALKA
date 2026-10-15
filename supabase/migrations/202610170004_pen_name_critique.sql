-- Kalem adı + eleştiri isteği: posts'a iki isteğe bağlı alan.
-- 202610170003_relay_stories.sql sonrasında çalıştırılır.

alter table public.posts
  add column if not exists pen_name text check (length(pen_name) <= 60);

alter table public.posts
  add column if not exists critique_wanted boolean not null default false;

create index if not exists posts_critique_idx
  on public.posts (critique_wanted) where critique_wanted = true;

notify pgrst, 'reload schema';
