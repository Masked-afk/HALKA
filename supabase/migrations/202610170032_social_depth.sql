-- Sosyal derinlik paketi: DM sabitleme, topluluk davet linki, kanal rolleri,
-- zengin durum, arkadaşlara özel eserler, medya ilerlemesi, bölüm beğenisi,
-- bölüm taslağı, ortak üretim odaları, sesli mesaj desteği.
-- 202610170031_beta_invites.sql sonrasında çalıştırılır.

-- ═══════════ 1) DM'de sabitlenen mesajlar ═══════════
alter table public.messages
  add column if not exists pinned_by uuid references auth.users(id) on delete set null;

grant update (pinned_by) on public.messages to authenticated;

-- Güvenlik sertleştirme: alıcı "okundu" politikası üzerinden başkasının
-- mesajının body/edited_at/deleted_at alanını değiştiremesin.
create or replace function public.messages_update_guard()
returns trigger language plpgsql security definer set search_path = ''
as $$
begin
  if auth.uid() is distinct from old.sender_id then
    new.body := old.body;
    new.edited_at := old.edited_at;
    new.deleted_at := old.deleted_at;
    new.shared_post_id := old.shared_post_id;
    new.attachment_path := old.attachment_path;
    new.attachment_mime := old.attachment_mime;
    new.attachment_name := old.attachment_name;
  end if;
  return new;
end;
$$;
revoke all on function public.messages_update_guard() from public;

drop trigger if exists trg_messages_update_guard on public.messages;
create trigger trg_messages_update_guard before update on public.messages
  for each row execute function public.messages_update_guard();

drop policy if exists "Members can pin messages" on public.messages;
create policy "Members can pin messages"
  on public.messages for update to authenticated
  using (public.is_conversation_member(conversation_id))
  with check (public.is_conversation_member(conversation_id));

-- ═══════════ 2) Topluluk davet linki ═══════════
-- NOT: Bu bölüm ilk sürümde communities.invite_code kolonu olarak uygulandı;
-- 202610170033_invite_link_table.sql ile ayrı tabloya taşındı (kod sızıntısını önler).
alter table public.communities
  add column if not exists invite_code text;

update public.communities
  set invite_code = upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 8))
  where invite_code is null;

create unique index if not exists communities_invite_code_unique
  on public.communities (invite_code);

create or replace function public.join_community_by_code(p_code text)
returns uuid language plpgsql security definer set search_path = ''
as $$
declare
  v_id uuid;
begin
  if auth.uid() is null then raise exception 'Giriş yapmalısın.'; end if;
  select c.id into v_id from public.communities c
    where c.invite_code = upper(btrim(p_code));
  if v_id is null then raise exception 'Davet kodu geçersiz.'; end if;
  insert into public.community_members (community_id, user_id, role)
    values (v_id, auth.uid(), 'member')
    on conflict (community_id, user_id) do nothing;
  return v_id;
end;
$$;
revoke all on function public.join_community_by_code(text) from public;
grant execute on function public.join_community_by_code(text) to authenticated;

create or replace function public.rotate_invite_code(p_community uuid)
returns text language plpgsql security definer set search_path = ''
as $$
declare
  v_code text;
begin
  if not public.is_community_admin(p_community)
     and not exists (select 1 from public.communities c
        where c.id = p_community and c.created_by = auth.uid()) then
    raise exception 'Yalnızca yöneticiler davet kodunu yenileyebilir.';
  end if;
  v_code := upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 8));
  update public.communities set invite_code = v_code where id = p_community;
  return v_code;
end;
$$;
revoke all on function public.rotate_invite_code(uuid) from public;
grant execute on function public.rotate_invite_code(uuid) to authenticated;

-- ═══════════ 3) Kanal yazma rolü (duyuru kanalları) ═══════════
alter table public.community_channels
  add column if not exists min_write_role text not null default 'member'
    check (min_write_role in ('member','admin'));

grant update (min_write_role) on public.community_channels to authenticated;

drop policy if exists "Members send channel messages" on public.community_channel_messages;
create policy "Members send channel messages"
  on public.community_channel_messages for insert to authenticated
  with check (
    sender_id = auth.uid()
    and exists (
      select 1 from public.community_channels ch
      where ch.id = channel_id
        and public.is_community_member(ch.community_id)
        and (ch.min_write_role = 'member' or public.is_community_admin(ch.community_id))
    )
  );

-- ═══════════ 4) Zengin durum ═══════════
alter table public.profiles
  add column if not exists now_doing text,
  add column if not exists now_doing_at timestamptz;

-- ═══════════ 5) "Sadece arkadaşlarım" eser görünürlüğü ═══════════
alter table public.posts
  add column if not exists visibility text not null default 'public'
    check (visibility in ('public','friends'));

create index if not exists posts_visibility_idx on public.posts (visibility)
  where visibility <> 'public';

-- İki yönlü kabul edilmiş arkadaşlık kontrolü
create or replace function public.is_friend(target uuid)
returns boolean language sql stable security definer set search_path = ''
as $$
  select exists (
    select 1 from public.friend_requests fr
    where fr.status = 'accepted'
      and ((fr.sender_id = auth.uid() and fr.receiver_id = target)
        or (fr.sender_id = target and fr.receiver_id = auth.uid()))
  );
$$;
revoke all on function public.is_friend(uuid) from public;
grant execute on function public.is_friend(uuid) to authenticated;

-- Restrictive kapı: 'friends' eserler yalnızca yazar, arkadaşlar ve beta okurlar.
-- anon + authenticated ikisine de uygulanır (restrictive politikalar role göre AND'lenir).
drop policy if exists "Respect post audience" on public.posts;
create policy "Respect post audience"
  on public.posts as restrictive for select to public
  using (
    visibility = 'public'
    or author_id = auth.uid()
    or public.is_friend(author_id)
    or public.has_beta_access(id)
  );

-- ═══════════ 6) Medya "kaldığın yerden" ═══════════
create table if not exists public.playback_positions (
  post_id uuid not null references public.posts(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  position_seconds numeric not null default 0 check (position_seconds >= 0),
  duration_seconds numeric,
  updated_at timestamptz not null default now(),
  primary key (post_id, user_id)
);
alter table public.playback_positions enable row level security;
grant select, insert, update, delete on public.playback_positions to authenticated;

drop policy if exists "Users manage own playback" on public.playback_positions;
create policy "Users manage own playback"
  on public.playback_positions for all to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

-- ═══════════ 7) Bölüm bazlı beğeni ═══════════
alter table public.chapters
  add column if not exists is_draft boolean not null default false;

create table if not exists public.chapter_likes (
  chapter_id uuid not null references public.chapters(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (chapter_id, user_id)
);
create index if not exists chapter_likes_user_idx on public.chapter_likes (user_id, chapter_id);
alter table public.chapter_likes enable row level security;
grant select, insert, delete on public.chapter_likes to authenticated;

drop policy if exists "Readers see chapter likes" on public.chapter_likes;
create policy "Readers see chapter likes"
  on public.chapter_likes for select to authenticated
  using (exists (
    select 1 from public.chapters ch
    join public.posts p on p.id = ch.post_id
    where ch.id = chapter_id
      and (not coalesce(ch.is_draft, false) or p.author_id = auth.uid())
  ));

drop policy if exists "Readers like chapters" on public.chapter_likes;
create policy "Readers like chapters"
  on public.chapter_likes for insert to authenticated
  with check (
    user_id = auth.uid()
    and exists (
      select 1 from public.chapters ch
      join public.posts p on p.id = ch.post_id
      where ch.id = chapter_id
        and (not coalesce(ch.is_draft, false) or p.author_id = auth.uid())
    )
  );

drop policy if exists "Users unlike chapters" on public.chapter_likes;
create policy "Users unlike chapters"
  on public.chapter_likes for delete to authenticated
  using (user_id = auth.uid());

-- ═══════════ 8) Bölüm bazlı taslak ═══════════
-- Restrictive kapı: taslak bölümü yalnızca yazar (ve beta okur) görür.
-- anon + authenticated ikisine de uygulanır.
drop policy if exists "Hide draft chapters" on public.chapters;
create policy "Hide draft chapters"
  on public.chapters as restrictive for select to public
  using (
    not is_draft
    or public.is_post_author(post_id)
    or exists (select 1 from public.posts p where p.id = post_id and public.has_beta_access(p.id))
  );

-- ═══════════ 9) Ortak üretim odaları ═══════════
create table if not exists public.collab_rooms (
  id uuid primary key default gen_random_uuid(),
  name text not null check (length(btrim(name)) between 1 and 80),
  created_by uuid not null references auth.users(id) on delete cascade,
  doc text not null default '',
  updated_by uuid references auth.users(id) on delete set null,
  updated_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);
create index if not exists collab_rooms_created_idx on public.collab_rooms (created_at desc);

create table if not exists public.collab_room_members (
  room_id uuid not null references public.collab_rooms(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  joined_at timestamptz not null default now(),
  primary key (room_id, user_id)
);
create index if not exists collab_room_members_user_idx on public.collab_room_members (user_id);

alter table public.collab_rooms enable row level security;
alter table public.collab_room_members enable row level security;
grant select, insert, update, delete on public.collab_rooms to authenticated;
grant select, insert, delete on public.collab_room_members to authenticated;

create or replace function public.is_room_member(target uuid)
returns boolean language sql stable security definer set search_path = ''
as $$
  select exists (
    select 1 from public.collab_room_members m
    where m.room_id = target and m.user_id = auth.uid()
  );
$$;
revoke all on function public.is_room_member(uuid) from public;
grant execute on function public.is_room_member(uuid) to authenticated;

drop policy if exists "Members read rooms" on public.collab_rooms;
create policy "Members read rooms"
  on public.collab_rooms for select to authenticated
  using (public.is_room_member(id) or created_by = auth.uid());

drop policy if exists "Users create rooms" on public.collab_rooms;
create policy "Users create rooms"
  on public.collab_rooms for insert to authenticated
  with check (created_by = auth.uid());

drop policy if exists "Members write doc" on public.collab_rooms;
create policy "Members write doc"
  on public.collab_rooms for update to authenticated
  using (public.is_room_member(id))
  with check (public.is_room_member(id));

drop policy if exists "Creator deletes room" on public.collab_rooms;
create policy "Creator deletes room"
  on public.collab_rooms for delete to authenticated
  using (created_by = auth.uid());

drop policy if exists "Members read membership" on public.collab_room_members;
create policy "Members read membership"
  on public.collab_room_members for select to authenticated
  using (public.is_room_member(room_id));

drop policy if exists "Join or invite" on public.collab_room_members;
create policy "Join or invite"
  on public.collab_room_members for insert to authenticated
  with check (
    user_id = auth.uid()
    or exists (select 1 from public.collab_rooms r
      where r.id = room_id and r.created_by = auth.uid())
  );

drop policy if exists "Leave or kick" on public.collab_room_members;
create policy "Leave or kick"
  on public.collab_room_members for delete to authenticated
  using (
    user_id = auth.uid()
    or exists (select 1 from public.collab_rooms r
      where r.id = room_id and r.created_by = auth.uid())
  );

-- ═══════════ 10) Sesli mesaj: chat-media mime genişletme ═══════════
update storage.buckets
  set allowed_mime_types = array[
    'image/jpeg','image/png','image/webp','image/gif',
    'video/mp4','video/webm','application/pdf',
    'audio/webm','audio/ogg','audio/mp4','audio/mpeg','audio/wav'
  ]
  where id = 'chat-media';

-- ═══════════ 11) Realtime yayınları ═══════════
do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    begin execute 'alter publication supabase_realtime add table public.collab_rooms'; exception when duplicate_object then null; end;
    begin execute 'alter publication supabase_realtime add table public.collab_room_members'; exception when duplicate_object then null; end;
  end if;
end $$;

notify pgrst, 'reload schema';
