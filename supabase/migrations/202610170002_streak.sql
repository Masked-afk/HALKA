-- Üretim serisi (streak): ardışık günlerde eser/story paylaşma sayacı.
-- Gün sınırları Europe/Istanbul saat dilimine göre hesaplanır.
-- 202610170001_search_trgm.sql sonrasında çalıştırılır.

create or replace function public.production_streak(target uuid)
returns jsonb
language plpgsql stable security invoker set search_path = ''
as $$
declare
  days date[];
  streak int;
  expected date;
  i int;
begin
  select array_agg(d order by d desc) into days
  from (
    select distinct (p.created_at at time zone 'Europe/Istanbul')::date as d
      from public.posts p where p.author_id = target
    union
    select distinct (s.created_at at time zone 'Europe/Istanbul')::date
      from public.stories s where s.user_id = target
  ) t;

  if days is null or array_length(days, 1) is null then
    return jsonb_build_object('streak', 0, 'last_date', null);
  end if;

  expected := (now() at time zone 'Europe/Istanbul')::date;
  if days[1] = expected then
    streak := 1;
  elsif days[1] = expected - 1 then
    streak := 1;
    expected := days[1];
  else
    return jsonb_build_object('streak', 0, 'last_date', days[1]);
  end if;

  for i in 2..array_length(days, 1) loop
    if days[i] = expected - 1 then
      streak := streak + 1;
      expected := days[i];
    elsif days[i] < expected - 1 then
      exit;
    end if;
  end loop;

  return jsonb_build_object('streak', streak, 'last_date', days[1]);
end;
$$;
revoke all on function public.production_streak(uuid) from public;
grant execute on function public.production_streak(uuid) to anon, authenticated;

notify pgrst, 'reload schema';
