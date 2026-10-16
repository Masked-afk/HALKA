-- Profil ozellestirme: vitrin eseri + sabitlenmis herkese acik koleksiyon.
alter table public.profiles
  add column if not exists featured_post_id uuid references public.posts(id) on delete set null,
  add column if not exists pinned_collection_id uuid references public.collections(id) on delete set null;

notify pgrst, 'reload schema';
