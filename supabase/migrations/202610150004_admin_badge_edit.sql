-- Admin: özel rozet düzenleme + Türkçe-duyarlı arama düzeltmesi.
-- 202610150003_fix_created_at_trigger.sql sonrasında çalıştırılır.

-- 1) search_halka: ilike collation'a takılıp Türkçe büyük/küçük harfleri
--    kaçırabiliyordu (İ/i/ı/I, Ş/s, Ğ/g, Ü/u, Ö/o, Ç/c). Artık regex karakter
--    sınıflarıyla büyük/küçük harf ve Türkçe varyantlar birlikte eşleşir.
create or replace function public.search_halka(q text)
returns jsonb
language plpgsql stable security invoker set search_path = ''
as $$
declare
  raw text := left(btrim(coalesce(q, '')), 80);
  pat text;
begin
  if raw = '' then
    return jsonb_build_object('users', '[]'::jsonb, 'posts', '[]'::jsonb, 'communities', '[]'::jsonb);
  end if;
  pat := regexp_replace(raw, '([\\^$.|?*+()\[\]{}])', '\\\1', 'g');
  pat := regexp_replace(pat, '[iİIı]', '[iİIı]', 'g');
  pat := regexp_replace(pat, '[sSŞş]', '[sSŞş]', 'g');
  pat := regexp_replace(pat, '[gGĞğ]', '[gGĞğ]', 'g');
  pat := regexp_replace(pat, '[uUÜü]', '[uUÜü]', 'g');
  pat := regexp_replace(pat, '[oOÖö]', '[oOÖö]', 'g');
  pat := regexp_replace(pat, '[cCÇç]', '[cCÇç]', 'g');

  return jsonb_build_object(
    'users', coalesce((
      select jsonb_agg(row_to_json(u)) from (
        select id, username, display_name, avatar_path, last_active_at
        from public.profiles
        where username ~ pat or display_name ~ pat
        order by username
        limit 8
      ) u
    ), '[]'::jsonb),
    'posts', coalesce((
      select jsonb_agg(row_to_json(p)) from (
        select id, title, type, kind, author_id, view_count, created_at, tags
        from public.posts
        where title ~ pat
           or description ~ pat
           or exists (select 1 from unnest(tags) tg where tg ~ pat)
        order by created_at desc
        limit 12
      ) p
    ), '[]'::jsonb),
    'communities', coalesce((
      select jsonb_agg(row_to_json(c)) from (
        select id, name, description, color
        from public.communities
        where name ~ pat or description ~ pat
        order by name
        limit 8
      ) c
    ), '[]'::jsonb)
  );
end;
$$;
revoke all on function public.search_halka(text) from public;
grant execute on function public.search_halka(text) to anon, authenticated;

create or replace function public.admin_update_badge(b_key text, badge_name text, badge_desc text default '', badge_icon text default '✦')
returns jsonb
language plpgsql security definer set search_path = ''
as $$
begin
  if not public.is_current_user_admin() then
    raise exception 'Yönetici yetkisi gerekli.' using errcode = '42501';
  end if;
  if btrim(coalesce(badge_name, '')) = '' then
    raise exception 'Rozet adı boş olamaz.';
  end if;
  if not exists (select 1 from public.custom_badges where badge_key = b_key) then
    raise exception 'Rozet bulunamadı.';
  end if;
  update public.custom_badges
    set name = left(btrim(badge_name), 40),
        description = left(btrim(coalesce(badge_desc, '')), 140),
        icon = coalesce(nullif(btrim(coalesce(badge_icon, '')), ''), '✦')
    where badge_key = b_key;
  return jsonb_build_object('ok', true);
end;
$$;
revoke all on function public.admin_update_badge(text, text, text, text) from public;
grant execute on function public.admin_update_badge(text, text, text, text) to authenticated;

notify pgrst, 'reload schema';
