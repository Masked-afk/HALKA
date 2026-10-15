-- Arama RPC'si + okuma ilerlemesi tablosu.
-- 202610150001_chat_realtime_badges.sql sonrasında çalıştırılır.

-- 1) Okuma ilerlemesi: kitap/eser sayfalarında kaldığın bölüm.
create table if not exists public.reading_progress (
  user_id uuid not null references auth.users(id) on delete cascade,
  post_id uuid not null references public.posts(id) on delete cascade,
  chapter_index int not null default 0 check (chapter_index >= 0),
  updated_at timestamptz not null default now(),
  primary key (user_id, post_id)
);
alter table public.reading_progress enable row level security;
grant select, insert, update, delete on public.reading_progress to authenticated;

drop policy if exists "Users read own progress" on public.reading_progress;
create policy "Users read own progress"
  on public.reading_progress for select to authenticated
  using (user_id = auth.uid());

drop policy if exists "Users write own progress" on public.reading_progress;
create policy "Users write own progress"
  on public.reading_progress for insert to authenticated
  with check (user_id = auth.uid());

drop policy if exists "Users update own progress" on public.reading_progress;
create policy "Users update own progress"
  on public.reading_progress for update to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

drop policy if exists "Users delete own progress" on public.reading_progress;
create policy "Users delete own progress"
  on public.reading_progress for delete to authenticated
  using (user_id = auth.uid());

-- updated_at istemciden gelmesin
create or replace function public.force_reading_progress_time()
returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;
revoke all on function public.force_reading_progress_time() from public;

drop trigger if exists trg_reading_progress_time on public.reading_progress;
create trigger trg_reading_progress_time before insert or update on public.reading_progress
  for each row execute function public.force_reading_progress_time();

-- 2) Tek çağrıda arama: kullanıcı + eser + topluluk.
--    security invoker: RLS görünürlük kuralları (gizli profil/eser) aynen uygulanır.
create or replace function public.search_halka(q text)
returns jsonb
language sql stable security invoker set search_path = ''
as $$
  with term as (
    select '%' || left(btrim(coalesce(q, '')), 80) || '%' as t
  )
  select jsonb_build_object(
    'users', coalesce((
      select jsonb_agg(row_to_json(u)) from (
        select id, username, display_name, avatar_path, last_active_at
        from public.profiles, term
        where username ilike term.t or display_name ilike term.t
        order by username
        limit 8
      ) u
    ), '[]'::jsonb),
    'posts', coalesce((
      select jsonb_agg(row_to_json(p)) from (
        select id, title, type, kind, author_id, view_count, created_at, tags
        from public.posts, term
        where title ilike term.t
           or description ilike term.t
           or exists (select 1 from unnest(tags) tg where tg ilike term.t)
        order by created_at desc
        limit 12
      ) p
    ), '[]'::jsonb),
    'communities', coalesce((
      select jsonb_agg(row_to_json(c)) from (
        select id, name, description, color
        from public.communities, term
        where name ilike term.t or description ilike term.t
        order by name
        limit 8
      ) c
    ), '[]'::jsonb)
  );
$$;
revoke all on function public.search_halka(text) from public;
grant execute on function public.search_halka(text) to anon, authenticated;

notify pgrst, 'reload schema';
