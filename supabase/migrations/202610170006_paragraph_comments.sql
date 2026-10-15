-- Paragraf bazlı yorumlar + zaman damgalı yorumlar (media_second).
-- paragraph_index NULL ise bölüm geneli yorum, değilse o paragrafa ait.
-- media_second NULL değilse yorum video/müzikte o saniyeye bağlı.
-- 202610170005_post_versions.sql sonrasında çalıştırılır.

alter table public.comments
  add column if not exists paragraph_index integer
  check (paragraph_index is null or paragraph_index >= 0);

-- Zaman damgalı yorumlar: video/müzik yorumları media_second taşıyabilir.
alter table public.comments
  add column if not exists media_second integer
  check (media_second is null or media_second >= 0);

create index if not exists comments_paragraph_idx
  on public.comments (chapter_id, paragraph_index)
  where paragraph_index is not null;

notify pgrst, 'reload schema';
