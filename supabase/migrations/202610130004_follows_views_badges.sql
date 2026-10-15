-- Takipçi sistemi + görüntülenme sayacı + öne çıkan eserler + rozet/rank RPC'leri.

-- 1) Takip tablosu
create table if not exists public.follows (
  follower_id uuid not null references auth.users(id) on delete cascade,
  followed_id uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (follower_id, followed_id),
  check (follower_id <> followed_id)
);
create index if not exists follows_followed_idx on public.follows(followed_id);
create index if not exists follows_follower_idx on public.follows(follower_id);

alter table public.follows enable row level security;
revoke all on public.follows from anon, authenticated;
grant select, insert, delete on public.follows to authenticated;

drop policy if exists "Follows are visible to involved users and public profiles" on public.follows;
create policy "Follows are visible to involved users and public profiles"
  on public.follows for select to authenticated
  using (
    auth.uid() = follower_id
    or auth.uid() = followed_id
    or public.can_view_profile(followed_id)
  );

drop policy if exists "Users can follow as themselves" on public.follows;
create policy "Users can follow as themselves"
  on public.follows for insert to authenticated
  with check (auth.uid() = follower_id and follower_id <> followed_id);

drop policy if exists "Users can unfollow" on public.follows;
create policy "Users can unfollow"
  on public.follows for delete to authenticated
  using (auth.uid() = follower_id);

drop policy if exists "Suspended accounts cannot use follows" on public.follows;
create policy "Suspended accounts cannot use follows"
  on public.follows as restrictive for all to authenticated
  using (public.current_user_can_use_app())
  with check (public.current_user_can_use_app());

-- 2) Takip bildirimi: notifications.type'a 'follow' ekle
alter table public.notifications drop constraint if exists notifications_type_check;
alter table public.notifications add constraint notifications_type_check
  check (type in ('like','comment','reply','friend_request','friend_accept','message','follow'));

create or replace function public.notify_on_follow()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  insert into public.notifications (user_id, actor_id, type)
    values (new.followed_id, new.follower_id, 'follow');
  return new;
end;
$$;

drop trigger if exists trg_notify_follow on public.follows;
create trigger trg_notify_follow after insert on public.follows
  for each row execute function public.notify_on_follow();

-- 3) Görüntülenme sayacı: doğrudan update kapalı, yalnızca RPC ile artırılır
alter table public.posts add column if not exists view_count bigint not null default 0;

create or replace function public.increment_post_view(target_post uuid)
returns void
language plpgsql security definer set search_path = ''
as $$
begin
  update public.posts set view_count = view_count + 1 where id = target_post;
end;
$$;
revoke all on function public.increment_post_view(uuid) from public;
grant execute on function public.increment_post_view(uuid) to anon, authenticated;

-- 4) Dönemsel öne çıkanlar: skor = beğeni×3 + görüntülenme, görünürlük kurallarına uyar
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
      and public.can_view_profile(p.author_id)
    order by coalesce(l.cnt, 0) * 3 + p.view_count desc, p.created_at desc
    limit result_limit
  ) ranked;
  return result;
end;
$$;
revoke all on function public.top_posts(text, int) from public;
grant execute on function public.top_posts(text, int) to anon, authenticated;

-- 5) Profil etkileşim + rozet + rank
create or replace function public.user_engagement(target_user uuid)
returns jsonb
language plpgsql stable security definer set search_path = ''
as $$
declare
  post_cnt int;
  like_cnt int;
  comment_cnt int;
  follower_cnt int;
  following_cnt int;
  community_cnt int;
  view_sum bigint;
  age_days int;
  score bigint;
  badges jsonb := '[]'::jsonb;
  rank_label text;
begin
  select count(*) into post_cnt from public.posts where author_id = target_user;
  select count(*) into like_cnt from public.likes l
    join public.posts p on p.id = l.post_id where p.author_id = target_user;
  select count(*) into comment_cnt from public.comments where author_id = target_user;
  select count(*) into follower_cnt from public.follows where followed_id = target_user;
  select count(*) into following_cnt from public.follows where follower_id = target_user;
  select count(*) into community_cnt from public.communities where created_by = target_user;
  select coalesce(sum(view_count), 0) into view_sum from public.posts where author_id = target_user;
  select floor(extract(epoch from (now() - created_at)) / 86400)::int into age_days
    from public.profiles where id = target_user;

  score := post_cnt * 3 + like_cnt * 2 + comment_cnt + follower_cnt * 5 + community_cnt * 10 + view_sum / 10;

  rank_label := case
    when score >= 800 then 'Usta Halka'
    when score >= 300 then 'Deneyimli'
    when score >= 100 then 'Üretken'
    when score >= 20 then 'Filizleniyor'
    else 'Yeni Halka'
  end;

  if post_cnt >= 1 then badges := badges || '"ilk_eser"'::jsonb; end if;
  if post_cnt >= 10 then badges := badges || '"uretken_10"'::jsonb; end if;
  if post_cnt >= 50 then badges := badges || '"uretken_50"'::jsonb; end if;
  if like_cnt >= 10 then badges := badges || '"sevilen_10"'::jsonb; end if;
  if like_cnt >= 100 then badges := badges || '"sevilen_100"'::jsonb; end if;
  if comment_cnt >= 25 then badges := badges || '"sohbetci_25"'::jsonb; end if;
  if follower_cnt >= 10 then badges := badges || '"cemiyet_10"'::jsonb; end if;
  if community_cnt >= 1 then badges := badges || '"kurucu"'::jsonb; end if;
  if coalesce(age_days, 0) >= 30 then badges := badges || '"kidiy_30"'::jsonb; end if;
  if coalesce(age_days, 0) >= 365 then badges := badges || '"kidiy_365"'::jsonb; end if;

  return jsonb_build_object(
    'posts', post_cnt,
    'likes', like_cnt,
    'comments', comment_cnt,
    'followers', follower_cnt,
    'following', following_cnt,
    'views', view_sum,
    'score', score,
    'rank', rank_label,
    'badges', badges
  );
end;
$$;
revoke all on function public.user_engagement(uuid) from public;
grant execute on function public.user_engagement(uuid) to anon, authenticated;

notify pgrst, 'reload schema';
