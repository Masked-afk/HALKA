-- Okuma/dinleme geçmişi: giriş yapan kullanıcının açtığı eserler.
-- Aynı eseri tekrar açmak kaydı günceller (upsert), liste "en son görüntülenen" sıralıdır.
-- 202610170007_weekly_themes.sql sonrasında çalıştırılır.

create table if not exists public.view_history (
  user_id uuid not null references auth.users(id) on delete cascade,
  post_id uuid not null references public.posts(id) on delete cascade,
  viewed_at timestamptz not null default now(),
  primary key (user_id, post_id)
);
create index if not exists view_history_user_idx on public.view_history (user_id, viewed_at desc);

alter table public.view_history enable row level security;

-- Kullanıcı yalnızca kendi geçmişini görür, yazar ve siler.
drop policy if exists view_history_select on public.view_history;
create policy view_history_select on public.view_history
  for select to authenticated using (user_id = auth.uid());

drop policy if exists view_history_upsert on public.view_history;
create policy view_history_upsert on public.view_history
  for insert to authenticated with check (user_id = auth.uid());

drop policy if exists view_history_update on public.view_history;
create policy view_history_update on public.view_history
  for update to authenticated using (user_id = auth.uid());

drop policy if exists view_history_delete on public.view_history;
create policy view_history_delete on public.view_history
  for delete to authenticated using (user_id = auth.uid());

notify pgrst, 'reload schema';
