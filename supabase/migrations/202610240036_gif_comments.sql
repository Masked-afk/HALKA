-- GIF yorumları: comments.gif_url (harici GIPHY URL'si).
-- 202610240035_interaction_pack.sql sonrasında çalıştırılır.

alter table public.comments
  add column if not exists gif_url text;

notify pgrst, 'reload schema';
