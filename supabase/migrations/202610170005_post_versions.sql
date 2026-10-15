-- Versiyon geçmişi: "bu çizimin 3. versiyonu" — eserin eski halleri arşivlenir,
-- posts satırı her zaman güncel sürümü taşır.
-- 202610170004_pen_name_critique.sql sonrasında çalıştırılır.

create table if not exists public.post_versions (
  id uuid primary key default gen_random_uuid(),
  post_id uuid not null references public.posts(id) on delete cascade,
  version_no integer not null check (version_no >= 1),
  title text,
  content text,
  media_url text,
  note text check (length(note) <= 200),
  created_at timestamptz not null default now(),
  unique (post_id, version_no)
);

create index if not exists post_versions_post_idx
  on public.post_versions (post_id, version_no);

alter table public.post_versions enable row level security;

-- Eseri görebilen versiyonlarını da görür (posts'lar bu sitede herkese açık listelenir).
drop policy if exists post_versions_select on public.post_versions;
create policy post_versions_select on public.post_versions
  for select to anon, authenticated using (true);

-- Sadece eser sahibi versiyon kaydı oluşturabilir.
drop policy if exists post_versions_insert on public.post_versions;
create policy post_versions_insert on public.post_versions
  for insert to authenticated
  with check (
    exists (select 1 from public.posts p
            where p.id = post_id and p.author_id = auth.uid())
  );

drop policy if exists post_versions_delete on public.post_versions;
create policy post_versions_delete on public.post_versions
  for delete to authenticated
  using (
    exists (select 1 from public.posts p
            where p.id = post_id and p.author_id = auth.uid())
  );

notify pgrst, 'reload schema';
