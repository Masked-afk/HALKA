-- Taslaklar: eser yayınlanmadan kaydedilebilir; yalnızca sahibi görür.
-- Yayınlanınca takipçilere bildirim o anda gider.
-- 202610170022_feature_badges.sql sonrasında çalıştırılır.

alter table public.posts
  add column if not exists is_draft boolean not null default false;
create index if not exists posts_draft_idx on public.posts (author_id, created_at desc) where is_draft;

-- Taslaklar yalnızca yazara görünür (mevcut permissive + restrictive yapıya ek restrictive politika)
drop policy if exists "Drafts visible only to author" on public.posts;
create policy "Drafts visible only to author" on public.posts
  as restrictive for select to anon, authenticated
  using (is_draft = false or author_id = auth.uid());

-- top_posts security definer çalışır; taslakları elle dışla
create or replace function public.top_posts(period text, result_limit int default 6)
returns jsonb
language plpgsql stable security definer set search_path = ''
as $$
declare
  cutoff timestamptz;
  result jsonb;
begin
  cutoff := case period
    when 'day' then now() - interval '1 day'
    when 'month' then now() - interval '30 days'
    when 'year' then now() - interval '365 days'
    else now() - interval '30 days'
  end;
  if result_limit is null or result_limit < 1 or result_limit > 20 then result_limit := 6; end if;

  select coalesce(jsonb_agg(row_data order by (row_data->>'score')::bigint desc), '[]'::jsonb)
  into result
  from (
    select to_jsonb(p) || jsonb_build_object(
        'like_count', coalesce(l.cnt, 0),
        'score', coalesce(l.cnt, 0) * 3 + p.view_count
      ) as row_data
    from public.posts p
    left join (select post_id, count(*) as cnt from public.likes group by post_id) l
      on l.post_id = p.id
    where p.created_at >= cutoff
      and p.is_draft = false
      and public.can_view_profile(p.author_id)
    order by coalesce(l.cnt, 0) * 3 + p.view_count desc, p.created_at desc
    limit result_limit
  ) ranked;
  return result;
end;
$$;
revoke all on function public.top_posts(text, int) from public;
grant execute on function public.top_posts(text, int) to anon, authenticated;

-- Profil istatistiği taslakları saymasın
create or replace function public.get_profile_stats(target_profile_id uuid)
returns jsonb
language plpgsql stable security definer set search_path = ''
as $$
declare
  result jsonb;
begin
  if not public.can_view_profile(target_profile_id) then
    raise exception 'Bu profilin istatistikleri görüntülenemiyor.' using errcode = '42501';
  end if;
  if auth.uid() is distinct from target_profile_id and exists (
    select 1 from public.profiles p where p.id = target_profile_id and p.stats_visibility = 'private'
  ) then
    raise exception 'Bu kullanıcının istatistikleri gizli.' using errcode = '42501';
  end if;
  select jsonb_build_object(
    'posts_count', (select count(*) from public.posts p where p.author_id = target_profile_id and p.is_draft = false),
    'likes_received', (select count(*) from public.likes l join public.posts p on p.id = l.post_id where p.author_id = target_profile_id and p.is_draft = false),
    'comments_count', (select count(*) from public.comments c join public.posts p on p.id = c.post_id where p.author_id = target_profile_id and p.is_draft = false)
  ) into result;
  return result;
end;
$$;
revoke all on function public.get_profile_stats(uuid) from public;
grant execute on function public.get_profile_stats(uuid) to anon, authenticated;

-- Yeni-eser bildirimi: taslak insert'te sus; taslak yayınlanınca bildir
create or replace function public.notify_followers_on_post()
returns trigger language plpgsql security definer set search_path = ''
as $$
begin
  insert into public.notifications (user_id, actor_id, type, post_id)
  select f.follower_id, new.author_id, 'new_post', new.id
  from public.follows f
  where f.followed_id = new.author_id
    and f.follower_id <> new.author_id
  limit 500;
  return new;
end;
$$;
revoke all on function public.notify_followers_on_post() from public;

drop trigger if exists trg_notify_new_post on public.posts;
create trigger trg_notify_new_post after insert on public.posts
  for each row when (new.is_draft = false)
  execute function public.notify_followers_on_post();

drop trigger if exists trg_notify_draft_published on public.posts;
create trigger trg_notify_draft_published after update on public.posts
  for each row when (old.is_draft = true and new.is_draft = false)
  execute function public.notify_followers_on_post();

notify pgrst, 'reload schema';
