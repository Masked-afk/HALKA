-- Güvenlik sertleştirmesi: yazma politikalarını sıkılaştırır, sütun grant'larını daraltır,
-- kurucu koruması ve medya URL kısıtı ekler. Tamamı idempotent.

-- 1) Sütun-bazlı UPDATE grant'ları (yalnızca istemcinin gerçekten yazdığı alanlar)
revoke update on public.profiles from authenticated;
grant update (username, display_name, bio, avatar_path, cover_path,
  profile_visibility, stats_visibility, profile_accent, profile_layout,
  last_active_at) on public.profiles to authenticated;

revoke update on public.comments from authenticated;
grant update (body) on public.comments to authenticated;

do $$
begin
  if to_regclass('public.friend_requests') is not null then
    execute 'revoke update on public.friend_requests from authenticated';
    execute 'grant update (status, updated_at) on public.friend_requests to authenticated';
  end if;
  if to_regclass('public.notifications') is not null then
    execute 'revoke update on public.notifications from authenticated';
    execute 'grant update (read_at) on public.notifications to authenticated';
  end if;
end $$;

-- 2) conversation_members: doğrudan self-join kapat. Üyelik yalnızca security definer
--    RPC'lerle (create_conversation, join_community, respond_community_invite, leave_community)
drop policy if exists "Users can add themselves to conversations" on public.conversation_members;
drop policy if exists "Creators can add conversation members" on public.conversation_members;
revoke insert, delete, update on public.conversation_members from authenticated;

-- 3) Temel tabloların yazma politikalarını açık sahiplik kontrolüyle yeniden tanımla.
--    (Dashboard'da oluşturulan sürümlerin with check'i olmayabilir.)
drop policy if exists "Users create own posts" on public.posts;
create policy "Users create own posts"
  on public.posts for insert to authenticated
  with check (author_id = auth.uid());

drop policy if exists "Users update own posts" on public.posts;
create policy "Users update own posts"
  on public.posts for update to authenticated
  using (author_id = auth.uid())
  with check (author_id = auth.uid());

drop policy if exists "Users delete own posts" on public.posts;
create policy "Users delete own posts"
  on public.posts for delete to authenticated
  using (author_id = auth.uid());

drop policy if exists "Giriş yapanlar ekleyebilir" on public.comments;
create policy "Giriş yapanlar ekleyebilir"
  on public.comments for insert to authenticated
  with check (author_id = auth.uid());

drop policy if exists "Kendi yorumunu silebilir" on public.comments;
create policy "Kendi yorumunu silebilir"
  on public.comments for delete to authenticated
  using (
    author_id = auth.uid()
    or exists (select 1 from public.posts p where p.id = comments.post_id and p.author_id = auth.uid())
  );

drop policy if exists "Giriş yapanlar ekleyebilir" on public.likes;
create policy "Giriş yapanlar ekleyebilir"
  on public.likes for insert to authenticated
  with check (user_id = auth.uid());

drop policy if exists "Kendi beğenisini silebilir" on public.likes;
create policy "Kendi beğenisini silebilir"
  on public.likes for delete to authenticated
  using (user_id = auth.uid());

drop policy if exists "Post owners insert chapters" on public.chapters;
create policy "Post owners insert chapters"
  on public.chapters for insert to authenticated
  with check (exists (select 1 from public.posts p where p.id = chapters.post_id and p.author_id = auth.uid()));

drop policy if exists "Post owners update chapters" on public.chapters;
create policy "Post owners update chapters"
  on public.chapters for update to authenticated
  using (exists (select 1 from public.posts p where p.id = chapters.post_id and p.author_id = auth.uid()))
  with check (exists (select 1 from public.posts p where p.id = chapters.post_id and p.author_id = auth.uid()));

drop policy if exists "Post owners delete chapters" on public.chapters;
create policy "Post owners delete chapters"
  on public.chapters for delete to authenticated
  using (exists (select 1 from public.posts p where p.id = chapters.post_id and p.author_id = auth.uid()));

-- 4) Topluluk kurucusu koruması: kurucunun üyelik satırı yöneticilerce düşürülemez/atılamaz.
drop policy if exists "Community admins manage roles" on public.community_members;
create policy "Community admins manage roles"
  on public.community_members for update to authenticated
  using (
    public.is_community_admin(community_id)
    and not exists (
      select 1 from public.communities c
      where c.id = community_members.community_id and c.created_by = community_members.user_id
    )
  )
  with check (
    public.is_community_admin(community_id)
    and not exists (
      select 1 from public.communities c
      where c.id = community_members.community_id and c.created_by = community_members.user_id
    )
  );

drop policy if exists "Admins can remove members" on public.community_members;
create policy "Admins can remove members"
  on public.community_members for delete to authenticated
  using (
    (
      public.is_community_admin(community_id)
      or user_id = auth.uid()
    )
    and (
      user_id = auth.uid()
      or not exists (
        select 1 from public.communities c
        where c.id = community_members.community_id and c.created_by = community_members.user_id
      )
    )
  );

-- remove_community_member RPC'sinde de kurucu kontrolü
create or replace function public.remove_community_member(target_community uuid, target_user uuid)
returns void language plpgsql security definer set search_path = public
as $$
declare conv_id uuid;
begin
  if auth.uid() is null then raise exception 'Giriş yapmalısın.'; end if;
  if not public.is_community_admin(target_community) then raise exception 'Yetkin yok.'; end if;
  if target_user = auth.uid() then raise exception 'Kendini çıkarmak için ayrıl seçeneğini kullan.'; end if;
  if exists (select 1 from public.communities where id = target_community and created_by = target_user) then
    raise exception 'Topluluk kurucusu çıkarılamaz.';
  end if;
  select conversation_id into conv_id from public.communities where id = target_community;

  delete from public.community_members
  where community_id = target_community and user_id = target_user;

  if conv_id is not null then
    delete from public.conversation_members
    where conversation_id = conv_id and user_id = target_user;
  end if;
end;
$$;
revoke all on function public.remove_community_member(uuid, uuid) from public;
grant execute on function public.remove_community_member(uuid, uuid) to authenticated;

-- 5) Medya URL'leri: çizim/fotoğraf/video eserleri yalnızca kendi storage'ımızdan
--    (keyfi harici görsel = takip pikseli riski). Müzik bağlantıları harici olabilir.
alter table public.posts drop constraint if exists posts_media_url_trusted;
alter table public.posts add constraint posts_media_url_trusted
  check (
    media_url is null
    or (
      type in ('drawing', 'photo', 'video')
      and media_url ~ '^https://[a-z0-9-]+\.supabase\.co/'
    )
    or (
      (type is null or type in ('writing', 'music'))
      and media_url ~ '^https?://'
    )
  );

-- 6) Askıya alınmış hesaplar yeni tablolarda da engellenir
do $$
declare
  table_name text;
  protected_tables text[] := array[
    'communities', 'community_members', 'community_join_requests', 'community_invites',
    'notifications', 'saved_posts', 'friend_requests', 'blocks'
  ];
begin
  foreach table_name in array protected_tables loop
    if to_regclass(format('public.%I', table_name)) is not null then
      execute format('drop policy if exists %I on public.%I', 'Suspended accounts cannot use app data', table_name);
      execute format(
        'create policy %I on public.%I as restrictive for all to authenticated using (public.current_user_can_use_app()) with check (public.current_user_can_use_app())',
        'Suspended accounts cannot use app data', table_name
      );
    end if;
  end loop;
end $$;

notify pgrst, 'reload schema';
