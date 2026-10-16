-- Yazar okuma istatistikleri: eser sahibine okurlarının ANONIM ozeti.
-- view_history/reading_progress RLS'i okura ozeldir; bu RPC yalnizca toplu
-- sayimlar dondurur, tek tek kullanici ifsa etmez.
-- 202610170023_drafts.sql sonrasinda calistirilir.

create or replace function public.author_reading_stats(p_post uuid)
returns jsonb
language plpgsql stable security definer set search_path = ''
as $$
declare
  uid uuid := auth.uid();
  readers int;
  daily jsonb;
  chapter_reach jsonb;
  chapter_total int;
begin
  if uid is null then
    raise exception 'Giriş gerekli.' using errcode = '42501';
  end if;
  if not exists (select 1 from public.posts where id = p_post and author_id = uid) then
    raise exception 'Yalnızca kendi eserinin istatistiğini görebilirsin.' using errcode = '42501';
  end if;

  select count(*) into readers from public.view_history where post_id = p_post;

  select coalesce(jsonb_agg(jsonb_build_object('day', d, 'n', c) order by d), '[]'::jsonb)
    into daily
  from (
    select viewed_at::date as d, count(*) as c
    from public.view_history
    where post_id = p_post and viewed_at >= now() - interval '30 days'
    group by 1
  ) s;

  select count(*) into chapter_total from public.chapters where post_id = p_post;

  select coalesce(jsonb_agg(jsonb_build_object('chapter', chapter_index, 'n', c) order by chapter_index), '[]'::jsonb)
    into chapter_reach
  from (
    select chapter_index, count(*) as c
    from public.reading_progress
    where post_id = p_post
    group by 1
  ) s;

  return jsonb_build_object(
    'readers', readers,
    'daily', daily,
    'chapter_reach', chapter_reach,
    'chapter_total', chapter_total
  );
end;
$$;
revoke all on function public.author_reading_stats(uuid) from public;
grant execute on function public.author_reading_stats(uuid) to authenticated;

notify pgrst, 'reload schema';
