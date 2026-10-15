-- Arama performansı: pg_trgm trigram indeksleri + Türkçe-normalize arama.
-- halka_norm() Türkçe karakterleri ASCII'ye indirger; ilike sorguları
-- trigram GIN indekslerini kullanır (regex taraması yerine).
-- 202610160006_story_cleanup.sql sonrasında çalıştırılır.

create extension if not exists pg_trgm;

create or replace function public.halka_norm(t text)
returns text
language sql immutable strict parallel safe
as $$
  select lower(translate($1, 'İIıŞşĞğÜüÖöÇç', 'iiissgguuoocc'));
$$;
grant execute on function public.halka_norm(text) to anon, authenticated;

create index if not exists posts_title_trgm
  on public.posts using gin (public.halka_norm(title) gin_trgm_ops);
create index if not exists posts_desc_trgm
  on public.posts using gin (public.halka_norm(description) gin_trgm_ops);
create index if not exists profiles_username_trgm
  on public.profiles using gin (public.halka_norm(username) gin_trgm_ops);
create index if not exists profiles_display_trgm
  on public.profiles using gin (public.halka_norm(display_name) gin_trgm_ops);
create index if not exists communities_name_trgm
  on public.communities using gin (public.halka_norm(name) gin_trgm_ops);
create index if not exists communities_desc_trgm
  on public.communities using gin (public.halka_norm(description) gin_trgm_ops);

-- Aramayı normalize + indeks dostu ilike'a çevir (Türkçe varyantlar
-- halka_norm ile ASCII'ye indiği için ayrıca karakter sınıfına gerek yok).
create or replace function public.search_halka(q text)
returns jsonb
language sql stable security invoker set search_path = ''
as $$
  with term as (
    select '%' || replace(replace(public.halka_norm(left(btrim(coalesce(q, '')), 80)), '%', '\%'), '_', '\_') || '%' as t
  )
  select jsonb_build_object(
    'users', coalesce((
      select jsonb_agg(row_to_json(u)) from (
        select id, username, display_name, avatar_path, last_active_at
        from public.profiles, term
        where public.halka_norm(username) ilike term.t
           or public.halka_norm(display_name) ilike term.t
        order by username
        limit 8
      ) u
    ), '[]'::jsonb),
    'posts', coalesce((
      select jsonb_agg(row_to_json(p)) from (
        select id, title, type, kind, author_id, view_count, created_at, tags
        from public.posts, term
        where public.halka_norm(title) ilike term.t
           or public.halka_norm(description) ilike term.t
           or exists (select 1 from unnest(tags) tg where public.halka_norm(tg) ilike term.t)
        order by created_at desc
        limit 12
      ) p
    ), '[]'::jsonb),
    'communities', coalesce((
      select jsonb_agg(row_to_json(c)) from (
        select id, name, description, color
        from public.communities, term
        where public.halka_norm(name) ilike term.t
           or public.halka_norm(description) ilike term.t
        order by name
        limit 8
      ) c
    ), '[]'::jsonb)
  );
$$;
revoke all on function public.search_halka(text) from public;
grant execute on function public.search_halka(text) to anon, authenticated;

notify pgrst, 'reload schema';
