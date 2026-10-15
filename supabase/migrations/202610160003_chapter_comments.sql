-- Bölüm bazlı yorumlar (Wattpad modeli): bir kitabın tek bir bölümüne
-- yorum bırakılabilir; ana yorum akışı chapter_id'si boş olanlardan oluşur.
-- 202610160002_new_post_notifications.sql sonrasında çalıştırılır.

alter table public.comments
  add column if not exists chapter_id uuid references public.chapters(id) on delete cascade;

create index if not exists comments_chapter_idx
  on public.comments(chapter_id) where chapter_id is not null;

notify pgrst, 'reload schema';
