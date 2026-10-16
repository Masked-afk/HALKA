-- İndirme izni: eser sahibi seçer. Varsayılan kapalı — işaretlenirse medyada
-- indir butonu/sağ tık serbest kalır, yoksa UI katmanında engellenir.
-- 202610170012_media_protection.sql sonrasında çalıştırılır.

alter table public.posts
  add column if not exists allow_download boolean not null default false;

notify pgrst, 'reload schema';
