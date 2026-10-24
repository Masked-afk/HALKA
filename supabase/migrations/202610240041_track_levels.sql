-- İz rozetleri 5 aşama: 1-10-50-100-250
create or replace function public.user_engagement(target_user uuid)
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  post_cnt int; view_sum bigint; max_views bigint; book_cnt int;
  type_cnts jsonb; type_distinct int;
  like_cnt int; comment_cnt int; follower_cnt int; following_cnt int;
  msg_cnt int; shared_msgs int; max_conv_msgs bigint;
  friends_cnt int; member_cnt int; comm_created int; max_comm_members bigint;
  saved_cnt int; bugs int; bugs_resolved int; commented_types int;
  first_comment_cnt int; night04 int; night56 int; weekend_weeks int;
  lucky13 boolean; geri_donus_flag boolean; clean_record boolean; streak int; age_days int; user_rank bigint;
  score bigint; live_keys text[]; new_keys text[]; all_keys text[];
  counts jsonb;
begin
  -- Eser sayımları
  select count(*), coalesce(sum(view_count),0), coalesce(max(view_count),0),
         count(*) filter (where kind = 'book')
    into post_cnt, view_sum, max_views, book_cnt
    from public.posts where author_id = target_user;

  select coalesce(jsonb_object_agg(t, c), '{}'::jsonb) into type_cnts from (
    select coalesce(type, 'writing') as t, count(*) as c
    from public.posts where author_id = target_user group by 1
  ) s;
  select count(*) into type_distinct from (select jsonb_object_keys(type_cnts)) k;

  -- Etkileşim sayımları
  select count(*) into like_cnt from public.likes l
    join public.posts p on p.id = l.post_id where p.author_id = target_user;
  select count(*) into comment_cnt from public.comments where author_id = target_user;
  select count(*) into follower_cnt from public.follows where followed_id = target_user;
  select count(*) into following_cnt from public.follows where follower_id = target_user;
  select count(*) into msg_cnt from public.messages where sender_id = target_user;
  select count(*) into shared_msgs from public.messages
    where sender_id = target_user and shared_post_id is not null;
  select coalesce(max(c),0) into max_conv_msgs from (
    select count(*) as c from public.messages where sender_id = target_user group by conversation_id) s;
  select count(*) into friends_cnt from public.friend_requests
    where status = 'accepted' and (sender_id = target_user or receiver_id = target_user);
  select count(*) into member_cnt from public.community_members where user_id = target_user;
  select count(*) into comm_created from public.communities where created_by = target_user;
  select coalesce(max(c),0) into max_comm_members from (
    select count(*) as c from public.community_members cm
    join public.communities co on co.id = cm.community_id
    where co.created_by = target_user group by cm.community_id) s;
  select count(*) into saved_cnt from public.saved_posts where user_id = target_user;
  select count(*), count(*) filter (where status = 'resolved') into bugs, bugs_resolved
    from public.bug_reports where user_id = target_user;
  select count(distinct coalesce(p.type,'writing')) into commented_types
    from public.comments c join public.posts p on p.id = c.post_id
    where c.author_id = target_user;

  -- İlk yorumcu: ilk yorumu attığı eser sayısı
  select count(*) into first_comment_cnt from (
    select distinct on (post_id) post_id, author_id
    from public.comments order by post_id, created_at asc) fc
    where fc.author_id = target_user;

  -- Zaman rozetleri
  select count(*) filter (where extract(hour from created_at) between 0 and 4),
         count(*) filter (where extract(hour from created_at) between 5 and 6),
         bool_or(extract(day from created_at) = 13 and extract(hour from created_at) = 13)
    into night04, night56, lucky13
    from public.posts where author_id = target_user;
  select count(distinct date_trunc('week', created_at)) into weekend_weeks
    from public.posts where author_id = target_user
      and extract(isodow from created_at) in (6,7);
  select exists (select 1 from (
      select created_at, lag(created_at) over (order by created_at) as prev
      from public.posts where author_id = target_user) g
    where g.prev is not null and g.created_at - g.prev >= interval '30 days')
    into geri_donus_flag;

  -- Streak: bugün veya dünle biten ardışık paylaşım günleri
  with days as (select distinct created_at::date as d from public.posts where author_id = target_user),
       r as (select d, d - (row_number() over (order by d))::int as grp from days)
  select case
    when (select max(d) from days) >= current_date - 1
    then (select count(*) from r where grp = (select grp from r where d = (select max(d) from days)))
    else 0 end into streak;

  -- Medeni rozeti için temiz sicil: hiç yönetim işlemi yememiş olmak
  select not exists (
    select 1 from public.moderation_actions ma
    where (ma.target_type = 'user' and ma.target_id = target_user::text)
       or (ma.action = 'remove_content' and exists (
             select 1 from public.posts p where p.id::text = ma.target_id and p.author_id = target_user
             union all
             select 1 from public.comments c where c.id::text = ma.target_id and c.author_id = target_user))
  ) into clean_record;

  select floor(extract(epoch from now() - created_at)/86400)::int into age_days
    from auth.users where id = target_user;
  select count(*) + 1 into user_rank from auth.users
    where created_at < (select created_at from auth.users where id = target_user);

  score := post_cnt * 3 + like_cnt * 2 + comment_cnt + follower_cnt * 5 + comm_created * 10 + view_sum / 10;

  -- Kazanılan rozet koşulları (canlı hesap)
  with pairs(key, ok) as (values
        ('trk_yazi_1',   coalesce((type_cnts->>'writing')::int,0) >= 1),
    ('trk_yazi_2',   coalesce((type_cnts->>'writing')::int,0) >= 10),
    ('trk_yazi_3',   coalesce((type_cnts->>'writing')::int,0) >= 50),
    ('trk_yazi_4',   coalesce((type_cnts->>'writing')::int,0) >= 100),
    ('trk_yazi_5',   coalesce((type_cnts->>'writing')::int,0) >= 250),
    ('trk_cizim_1',  coalesce((type_cnts->>'drawing')::int,0) >= 1),
    ('trk_cizim_2',  coalesce((type_cnts->>'drawing')::int,0) >= 10),
    ('trk_cizim_3',  coalesce((type_cnts->>'drawing')::int,0) >= 50),
    ('trk_cizim_4',  coalesce((type_cnts->>'drawing')::int,0) >= 100),
    ('trk_cizim_5',  coalesce((type_cnts->>'drawing')::int,0) >= 250),
    ('trk_foto_1',   coalesce((type_cnts->>'photo')::int,0) >= 1),
    ('trk_foto_2',   coalesce((type_cnts->>'photo')::int,0) >= 10),
    ('trk_foto_3',   coalesce((type_cnts->>'photo')::int,0) >= 50),
    ('trk_foto_4',   coalesce((type_cnts->>'photo')::int,0) >= 100),
    ('trk_foto_5',   coalesce((type_cnts->>'photo')::int,0) >= 250),
    ('trk_video_1',  coalesce((type_cnts->>'video')::int,0) >= 1),
    ('trk_video_2',  coalesce((type_cnts->>'video')::int,0) >= 10),
    ('trk_video_3',  coalesce((type_cnts->>'video')::int,0) >= 50),
    ('trk_video_4',  coalesce((type_cnts->>'video')::int,0) >= 100),
    ('trk_video_5',  coalesce((type_cnts->>'video')::int,0) >= 250),
    ('trk_muzik_1',  coalesce((type_cnts->>'music')::int,0) >= 1),
    ('trk_muzik_2',  coalesce((type_cnts->>'music')::int,0) >= 10),
    ('trk_muzik_3',  coalesce((type_cnts->>'music')::int,0) >= 50),
    ('trk_muzik_4',  coalesce((type_cnts->>'music')::int,0) >= 100),
    ('trk_muzik_5',  coalesce((type_cnts->>'music')::int,0) >= 250),
    ('trk_begeni_1', like_cnt >= 1),
    ('trk_begeni_2', like_cnt >= 10),
    ('trk_begeni_3', like_cnt >= 50),
    ('trk_begeni_4', like_cnt >= 100),
    ('trk_begeni_5', like_cnt >= 250),
    ('trk_takip_1',  follower_cnt >= 1),
    ('trk_takip_2',  follower_cnt >= 10),
    ('trk_takip_3',  follower_cnt >= 50),
    ('trk_takip_4',  follower_cnt >= 100),
    ('trk_takip_5',  follower_cnt >= 250),
    ('trk_katki_1',  bugs >= 1),
    ('trk_katki_2',  bugs >= 10),
    ('trk_katki_3',  bugs >= 50),
    ('trk_katki_4',  bugs >= 100),
    ('trk_katki_5',  bugs >= 250),
('ilk_eser',        post_cnt >= 1),
    ('ilk_kitap',       book_cnt >= 1),
    ('cok_yonlu',       type_distinct >= 4),
    ('tam_halka',       type_distinct >= 5),
    ('konusulan',       exists (select 1 from (select count(*) c from public.comments cm
                            join public.posts p on p.id = cm.post_id
                            where p.author_id = target_user group by cm.post_id) q where q.c >= 10)),
    ('hit',             exists (select 1 from (select count(*) c from public.likes li
                            join public.posts p on p.id = li.post_id
                            where p.author_id = target_user group by li.post_id) q where q.c >= 50)),
    ('fenomen',         max_views >= 200),
    ('koleksiyon_ruhu', saved_cnt >= 50),
    ('ilk_yorumun',     comment_cnt >= 1),
    ('sohbetci',        comment_cnt >= 25),
    ('tartismaci',      comment_cnt >= 200),
    ('mektup',          msg_cnt >= 100),
    ('geveze',          msg_cnt >= 1000),
    ('tanis',           friends_cnt >= 1),
    ('ag',              friends_cnt >= 20),
    ('katilimci',       member_cnt >= 1),
    ('kurucu',          comm_created >= 1),
    ('buyukelci',       max_comm_members >= 50),
    ('zincir',          streak >= 7),
    ('demir_irade',     streak >= 30),
    ('kidemli',         coalesce(age_days,0) >= 30),
    ('yerlesik',        coalesce(age_days,0) >= 180),
    ('veteran',         coalesce(age_days,0) >= 365),
    ('geri_donus',      geri_donus_flag),
    ('gece_kusu',       night04 >= 1),
    ('safak',           night56 >= 1),
    ('gece_yazari',     night04 + night56 >= 10),
    ('sansli_gun',      coalesce(lucky13, false)),
    ('erken_kus',       user_rank <= 100),
    ('sessiz_dev',      post_cnt >= 20 and comment_cnt = 0),
    ('ilk_yorumcu',     first_comment_cnt >= 10),
    ('hafta_sonu',      weekend_weeks >= 4),
    ('kopru',           shared_msgs >= 10),
    ('merakli',         commented_types >= 4),
    ('sirdas',          max_conv_msgs >= 500),
    ('bakim_gizlisi',   bugs_resolved >= 3),
    ('medeni',          member_cnt >= 3 and clean_record),
    ('cicek_acan',      coalesce((type_cnts->>'writing')::int,0) >= 1
                        and coalesce((type_cnts->>'drawing')::int,0) >= 1
                        and coalesce((type_cnts->>'photo')::int,0) >= 1
                        and coalesce((type_cnts->>'video')::int,0) >= 1
                        and coalesce((type_cnts->>'music')::int,0) >= 1),
    ('bahcivan',        exists (select 1 from jsonb_each(type_cnts) e where (e.value)::int >= 250)),
    ('uc_usta',         (select count(*) from jsonb_each(type_cnts) e where (e.value)::int >= 50) >= 3)
  )
  select coalesce(array_agg(key) filter (where ok), '{}') into live_keys from pairs;

  -- Kalıcı depoya yaz, bu çağrıda kazanılanları yakala
  with ins as (
    insert into public.user_badges (user_id, badge_key)
    select target_user, k from unnest(live_keys) as u(k)
    on conflict do nothing
    returning badge_key
  )
  select coalesce(array_agg(badge_key), '{}') into new_keys from ins;

  select coalesce(array_agg(badge_key), '{}') into all_keys
    from public.user_badges where user_id = target_user;

  counts := jsonb_build_object(
    'posts', post_cnt, 'likes', like_cnt, 'comments', comment_cnt,
    'followers', follower_cnt, 'following', following_cnt, 'views', view_sum,
    'messages', msg_cnt, 'friends', friends_cnt, 'bugs', bugs,
    'type_counts', type_cnts
  );

  return jsonb_build_object(
    'score', score,
    'counts', counts,
    'earned_keys', all_keys,
    'newly_earned', new_keys
  );
end;
$$;

notify pgrst, 'reload schema';
