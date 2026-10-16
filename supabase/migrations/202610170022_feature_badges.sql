-- Yeni özellik rozetleri: seriler, devam önerileri, listeler, kritik,
-- meydan okuma, manga/LN, relay, kolektif yayın, jam kuyruğu, okuma geçmişi.
-- user_engagement'tan ayrı çalışır; profil görüntülenmeden önce çağrılır.
-- 202610170021_critique_matches.sql sonrasında çalıştırılır.

create or replace function public.award_feature_badges(target_user uuid)
returns text[]
language plpgsql security definer set search_path = ''
as $$
declare
  awarded text[] := '{}';
  k text;
begin
  -- 📚 Seri kurdu: en az 2 eserli bir seri
  insert into public.user_badges (user_id, badge_key)
  select target_user, 'seri_kurdu'
  where exists (select 1 from public.post_series s
                join public.series_items i on i.series_id = s.id
                where s.author_id = target_user
                group by s.id having count(*) >= 2)
  on conflict do nothing returning badge_key into k;
  if k is not null then awarded := awarded || k; end if; k := null;

  -- 🧩 Devam kahramanı: devam önerisi yayınlanmış
  insert into public.user_badges (user_id, badge_key)
  select target_user, 'devam_kahramani'
  where exists (select 1 from public.post_continuations
                where author_id = target_user and status = 'accepted')
  on conflict do nothing returning badge_key into k;
  if k is not null then awarded := awarded || k; end if; k := null;

  -- 🚪 Kapı aralayan: kendi eserinde okur devamı yayınlamış
  insert into public.user_badges (user_id, badge_key)
  select target_user, 'kapi_aralayan'
  where exists (select 1 from public.post_continuations c
                join public.posts p on p.id = c.post_id
                where p.author_id = target_user and c.status = 'accepted')
  on conflict do nothing returning badge_key into k;
  if k is not null then awarded := awarded || k; end if; k := null;

  -- 📖 Liste kurucusu: herkese açık listesi var
  insert into public.user_badges (user_id, badge_key)
  select target_user, 'liste_kurucusu'
  where exists (select 1 from public.collections
                where user_id = target_user and is_public = true)
  on conflict do nothing returning badge_key into k;
  if k is not null then awarded := awarded || k; end if; k := null;

  -- 🔖 Liste sevdalısı: 3+ liste takip ediyor
  insert into public.user_badges (user_id, badge_key)
  select target_user, 'liste_sevdalisi'
  where (select count(*) from public.collection_follows where user_id = target_user) >= 3
  on conflict do nothing returning badge_key into k;
  if k is not null then awarded := awarded || k; end if; k := null;

  -- 🎯 Kritik ustası: 5+ kritik görevi tamamlamış
  insert into public.user_badges (user_id, badge_key)
  select target_user, 'kritik_ustasi'
  where (select count(*) from public.critique_matches
         where critic_id = target_user and done_at is not null) >= 5
  on conflict do nothing returning badge_key into k;
  if k is not null then awarded := awarded || k; end if; k := null;

  -- ⚡ Meydan efendisi: 3 farklı meydan okumaya katılmış
  insert into public.user_badges (user_id, badge_key)
  select target_user, 'meydan_efendisi'
  where (select count(distinct challenge_id) from public.challenge_entries
         where user_id = target_user) >= 3
  on conflict do nothing returning badge_key into k;
  if k is not null then awarded := awarded || k; end if; k := null;

  -- ⛩️ Mangaka: manga eseri var
  insert into public.user_badges (user_id, badge_key)
  select target_user, 'mangaka'
  where exists (select 1 from public.posts where author_id = target_user and kind = 'manga')
  on conflict do nothing returning badge_key into k;
  if k is not null then awarded := awarded || k; end if; k := null;

  -- 📓 Hafif romancı: light novel eseri var
  insert into public.user_badges (user_id, badge_key)
  select target_user, 'hafif_romanci'
  where exists (select 1 from public.posts where author_id = target_user and kind = 'light_novel')
  on conflict do nothing returning badge_key into k;
  if k is not null then awarded := awarded || k; end if; k := null;

  -- 🔁 Nöbetçi: nöbetleşe hikâyeye katılmış (tur yazmış veya ev sahibi/partner olmuş)
  insert into public.user_badges (user_id, badge_key)
  select target_user, 'nobetci'
  where exists (select 1 from public.relay_turns where author_id = target_user)
     or exists (select 1 from public.relay_stories
                where host_id = target_user or partner_id = target_user)
  on conflict do nothing returning badge_key into k;
  if k is not null then awarded := awarded || k; end if; k := null;

  -- 🤲 Kolektifçi: topluluk koleksiyonuna onaylanmış eser vermiş
  insert into public.user_badges (user_id, badge_key)
  select target_user, 'kolektifci'
  where exists (select 1 from public.community_collection_items
                where added_by = target_user and status = 'approved')
  on conflict do nothing returning badge_key into k;
  if k is not null then awarded := awarded || k; end if; k := null;

  -- 🎧 Jamci: topluluk kuyruğuna parça eklemiş
  insert into public.user_badges (user_id, badge_key)
  select target_user, 'jamci'
  where exists (select 1 from public.community_jam_queue where added_by = target_user)
  on conflict do nothing returning badge_key into k;
  if k is not null then awarded := awarded || k; end if; k := null;

  -- 📚 Aşık okur: 100+ farklı eser gezmiş (okuma geçmişi)
  insert into public.user_badges (user_id, badge_key)
  select target_user, 'asik_okur'
  where (select count(distinct post_id) from public.view_history where user_id = target_user) >= 100
  on conflict do nothing returning badge_key into k;
  if k is not null then awarded := awarded || k; end if;

  return awarded;
end $$;
revoke all on function public.award_feature_badges(uuid) from public;
grant execute on function public.award_feature_badges(uuid) to anon, authenticated;

notify pgrst, 'reload schema';
