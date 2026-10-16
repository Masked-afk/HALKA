-- Medya indirme koruması: post-media bucket'ı private yapılır.
-- Okuma yine "post media public read" select politikasıyla herkese açık —
-- fark: public URL artık kalıcı değil, createSignedUrls ile 1 saatlik
-- link üretilir. Upload/delete politikaları değişmiyor.
-- 202610170011_manga_pages.sql sonrasında çalıştırılır.

update storage.buckets set public = false where id = 'post-media';

-- Select politikası yoksa (yeniden) oluştur — signed URL üretebilmek için gerekli.
drop policy if exists "post media public read" on storage.objects;
create policy "post media public read"
  on storage.objects for select
  using (bucket_id = 'post-media');

notify pgrst, 'reload schema';
