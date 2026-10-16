-- Manga sayfaları: bölümler görsel sayfa taşıyabilir (chapters.media_url).
-- Görsel post-media bucket'ında public olarak saklanır, URL bu kolona yazılır.
-- 202610170010_manga_lightnovel.sql sonrasında çalıştırılır.

alter table public.chapters
  add column if not exists media_url text
  check (media_url is null or media_url ~ '^https?://' and length(media_url) <= 2000);

create index if not exists chapters_media_idx
  on public.chapters (post_id) where media_url is not null;

notify pgrst, 'reload schema';
