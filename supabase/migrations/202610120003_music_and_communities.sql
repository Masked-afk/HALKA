-- Music posts storage bucket and communities (members, roles, linked group chat).

-- 0. posts: media_url/type kolonları ve kind kısıtını müzik için genişlet
alter table public.posts
  add column if not exists media_url text,
  add column if not exists type text;

do $$
declare
  existing_check record;
begin
  for existing_check in
    select conname
    from pg_constraint
    where conrelid = 'public.posts'::regclass
      and contype = 'c'
      and (pg_get_constraintdef(oid) ilike '%kind in%'
        or pg_get_constraintdef(oid) ilike '%kind =%'
        or pg_get_constraintdef(oid) ilike '%type in%')
      and pg_get_constraintdef(oid) not ilike '%cover_path%'
  loop
    execute format('alter table public.posts drop constraint %I', existing_check.conname);
  end loop;
  alter table public.posts add constraint posts_kind_supported_check
    check (kind is null or kind in ('blog', 'short', 'book', 'story', 'poem', 'music', 'drawing', 'photo', 'video')) not valid;
end $$;
alter table public.posts validate constraint posts_kind_supported_check;

-- 1. Public storage bucket for post media (audio, later images/video)
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('post-media', 'post-media', true, 52428800, array['image/*', 'audio/*', 'video/*'])
on conflict (id) do update set
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "post media public read" on storage.objects;
create policy "post media public read"
  on storage.objects for select
  using (bucket_id = 'post-media');

drop policy if exists "post media authenticated upload" on storage.objects;
create policy "post media authenticated upload"
  on storage.objects for insert to authenticated
  with check (bucket_id = 'post-media' and (storage.foldername(name))[1] = auth.uid()::text);

drop policy if exists "post media owner delete" on storage.objects;
create policy "post media owner delete"
  on storage.objects for delete to authenticated
  using (bucket_id = 'post-media' and (storage.foldername(name))[1] = auth.uid()::text);

-- 2. Communities
-- Music posts can carry an optional album cover
alter table public.posts
  drop constraint if exists posts_book_cover_path_valid,
  add constraint posts_book_cover_path_valid
    check (
      cover_path is null
      or (
        author_id is not null
        and length(cover_path) <= 500
        and (
          (kind = 'book' and cover_path like author_id::text || '/book-covers/%')
          or (kind = 'music' and cover_path like author_id::text || '/music-covers/%')
        )
      )
    );

create table if not exists public.communities (
  id uuid primary key default gen_random_uuid(),
  name text not null check (length(trim(name)) between 3 and 60),
  description text not null default '',
  color text not null default '#D4537E' check (color ~ '^#[0-9A-Fa-f]{6}$'),
  join_policy text not null default 'open' check (join_policy in ('open','approval','invite')),
  created_by uuid not null references auth.users(id) on delete cascade,
  conversation_id uuid references public.conversations(id) on delete set null,
  created_at timestamptz not null default now()
);

-- Mevcut tabloya join_policy ekle (tablo daha önce oluşmuşsa)
alter table public.communities add column if not exists join_policy text not null default 'open';
alter table public.communities drop constraint if exists communities_join_policy_check;
alter table public.communities add constraint communities_join_policy_check check (join_policy in ('open','approval','invite'));

-- Aynı ada sahip topluluk olamaz (büyük/küçük harf duyarsız)
create unique index if not exists communities_name_lower_unique
  on public.communities (lower(name));

create table if not exists public.community_members (
  community_id uuid not null references public.communities(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role text not null default 'member' check (role in ('admin','member')),
  joined_at timestamptz not null default now(),
  primary key (community_id, user_id)
);

create index if not exists community_members_user_idx
  on public.community_members(user_id, community_id);

create or replace function public.is_community_admin(target_community uuid)
returns boolean language sql stable security definer set search_path = public
as $$
  select exists (
    select 1 from public.community_members m
    where m.community_id = target_community
      and m.user_id = auth.uid()
      and m.role = 'admin'
  );
$$;

revoke all on function public.is_community_admin(uuid) from public;
grant execute on function public.is_community_admin(uuid) to authenticated;

create table if not exists public.community_join_requests (
  id uuid primary key default gen_random_uuid(),
  community_id uuid not null references public.communities(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  status text not null default 'pending' check (status in ('pending','approved','rejected')),
  created_at timestamptz not null default now(),
  decided_at timestamptz,
  unique (community_id, user_id)
);

create table if not exists public.community_invites (
  id uuid primary key default gen_random_uuid(),
  community_id uuid not null references public.communities(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  invited_by uuid not null references auth.users(id) on delete cascade,
  status text not null default 'pending' check (status in ('pending','accepted','declined')),
  created_at timestamptz not null default now(),
  unique (community_id, user_id)
);

alter table public.community_join_requests enable row level security;
alter table public.community_invites enable row level security;

revoke all on public.community_join_requests from anon, authenticated;
revoke all on public.community_invites from anon, authenticated;
grant select on public.community_join_requests to authenticated;
grant select on public.community_invites to authenticated;

drop policy if exists "See own requests or admin requests" on public.community_join_requests;
create policy "See own requests or admin requests"
  on public.community_join_requests for select to authenticated
  using (user_id = auth.uid() or public.is_community_admin(community_id));

drop policy if exists "See own invites or admin invites" on public.community_invites;
create policy "See own invites or admin invites"
  on public.community_invites for select to authenticated
  using (user_id = auth.uid() or public.is_community_admin(community_id));

alter table public.conversations
  add column if not exists community_id uuid references public.communities(id) on delete cascade;

create index if not exists conversations_community_idx
  on public.conversations(community_id) where community_id is not null;

alter table public.communities enable row level security;
alter table public.community_members enable row level security;

revoke all on public.communities from anon, authenticated;
revoke all on public.community_members from anon, authenticated;
grant select on public.communities to anon, authenticated;
grant select on public.community_members to anon, authenticated;
-- Sütun-bazlı update: created_by ve conversation_id değiştirilemesin (topluluk ele geçirme koruması),
-- üyelik satırlarında yalnızca role güncellenebilsin.
revoke update on public.communities from authenticated;
revoke update on public.community_members from authenticated;
grant update (name, description, color, join_policy) on public.communities to authenticated;
grant update (role) on public.community_members to authenticated;

drop policy if exists "Anyone can read communities" on public.communities;
create policy "Anyone can read communities"
  on public.communities for select to anon, authenticated
  using (true);

drop policy if exists "Anyone can read members" on public.community_members;
create policy "Anyone can read members"
  on public.community_members for select to anon, authenticated
  using (true);

drop policy if exists "Community admins can update" on public.communities;
create policy "Community admins can update"
  on public.communities for update to authenticated
  using (public.is_community_admin(id) or created_by = auth.uid())
  with check (public.is_community_admin(id) or created_by = auth.uid());

drop policy if exists "Community creator can delete" on public.communities;
create policy "Community creator can delete"
  on public.communities for delete to authenticated
  using (created_by = auth.uid());

drop policy if exists "Community admins manage roles" on public.community_members;
create policy "Community admins manage roles"
  on public.community_members for update to authenticated
  using (public.is_community_admin(community_id))
  with check (public.is_community_admin(community_id));

drop policy if exists "Admins can remove members" on public.community_members;
create policy "Admins can remove members"
  on public.community_members for delete to authenticated
  using (public.is_community_admin(community_id) or user_id = auth.uid());

-- 3. RPC'ler: kur, katıl, ayrıl (community_members <-> conversation_members eşitleme)
drop function if exists public.create_community(text, text, text);
create or replace function public.create_community(community_name text, community_description text default '', community_color text default '#D4537E', community_join_policy text default 'open')
returns uuid language plpgsql security definer set search_path = public
as $$
declare
  new_community_id uuid;
  new_conversation_id uuid;
begin
  if auth.uid() is null then raise exception 'Giriş yapmalısın.'; end if;
  if community_join_policy not in ('open','approval','invite') then raise exception 'Geçersiz katılım türü.'; end if;
  if exists (select 1 from public.communities where lower(name) = lower(trim(community_name))) then
    raise exception 'Bu isimde bir topluluk zaten var.';
  end if;

  insert into public.conversations (created_by, title, is_group)
  values (auth.uid(), left(trim(community_name), 80), true)
  returning id into new_conversation_id;

  insert into public.communities (name, description, color, join_policy, created_by, conversation_id)
  values (trim(community_name), left(trim(community_description), 1200), community_color, community_join_policy, auth.uid(), new_conversation_id)
  returning id into new_community_id;

  update public.conversations set community_id = new_community_id where id = new_conversation_id;

  insert into public.community_members (community_id, user_id, role)
  values (new_community_id, auth.uid(), 'admin');

  insert into public.conversation_members (conversation_id, user_id)
  values (new_conversation_id, auth.uid());

  return new_community_id;
end;
$$;

create or replace function public.join_community(target_community uuid)
returns void language plpgsql security definer set search_path = public
as $$
declare conv_id uuid; policy text;
begin
  if auth.uid() is null then raise exception 'Giriş yapmalısın.'; end if;
  select conversation_id, join_policy into conv_id, policy from public.communities where id = target_community;
  if conv_id is null then raise exception 'Topluluk bulunamadı.'; end if;
  if policy = 'approval' then raise exception 'Bu topluluk katılma isteğiyle üye alıyor.'; end if;
  if policy = 'invite' then raise exception 'Bu topluluk yalnızca davetle üye alıyor.'; end if;

  insert into public.community_members (community_id, user_id)
  values (target_community, auth.uid())
  on conflict do nothing;

  insert into public.conversation_members (conversation_id, user_id)
  values (conv_id, auth.uid())
  on conflict do nothing;
end;
$$;

create or replace function public.request_join_community(target_community uuid)
returns void language plpgsql security definer set search_path = public
as $$
declare policy text;
begin
  if auth.uid() is null then raise exception 'Giriş yapmalısın.'; end if;
  select join_policy into policy from public.communities where id = target_community;
  if policy is null then raise exception 'Topluluk bulunamadı.'; end if;
  if policy <> 'approval' then raise exception 'Bu topluluk istek kabul etmiyor.'; end if;
  if exists (select 1 from public.community_members where community_id = target_community and user_id = auth.uid()) then
    raise exception 'Zaten üyesin.';
  end if;

  insert into public.community_join_requests (community_id, user_id, status, decided_at)
  values (target_community, auth.uid(), 'pending', null)
  on conflict (community_id, user_id)
  do update set status = 'pending', created_at = now(), decided_at = null;
end;
$$;

create or replace function public.decide_join_request(request_id uuid, approve boolean)
returns void language plpgsql security definer set search_path = public
as $$
declare req record; conv_id uuid;
begin
  if auth.uid() is null then raise exception 'Giriş yapmalısın.'; end if;
  select * into req from public.community_join_requests where id = request_id and status = 'pending';
  if req.id is null then raise exception 'İstek bulunamadı veya zaten yanıtlanmış.'; end if;
  if not public.is_community_admin(req.community_id) then raise exception 'Yetkin yok.'; end if;

  update public.community_join_requests
  set status = case when approve then 'approved' else 'rejected' end, decided_at = now()
  where id = request_id;

  if approve then
    select conversation_id into conv_id from public.communities where id = req.community_id;
    insert into public.community_members (community_id, user_id)
    values (req.community_id, req.user_id) on conflict do nothing;
    if conv_id is not null then
      insert into public.conversation_members (conversation_id, user_id)
      values (conv_id, req.user_id) on conflict do nothing;
    end if;
  end if;
end;
$$;

create or replace function public.invite_community_member(target_community uuid, target_username text)
returns void language plpgsql security definer set search_path = public
as $$
declare target_id uuid;
begin
  if auth.uid() is null then raise exception 'Giriş yapmalısın.'; end if;
  if not public.is_community_admin(target_community) then raise exception 'Yetkin yok.'; end if;
  select id into target_id from public.profiles where lower(username) = lower(trim(target_username));
  if target_id is null then raise exception 'Kullanıcı bulunamadı: %', target_username; end if;
  if exists (select 1 from public.community_members where community_id = target_community and user_id = target_id) then
    raise exception 'Bu kullanıcı zaten üye.';
  end if;

  insert into public.community_invites (community_id, user_id, invited_by, status)
  values (target_community, target_id, auth.uid(), 'pending')
  on conflict (community_id, user_id)
  do update set status = 'pending', invited_by = auth.uid(), created_at = now();
end;
$$;

create or replace function public.respond_community_invite(invite_id uuid, accept boolean)
returns void language plpgsql security definer set search_path = public
as $$
declare inv record; conv_id uuid;
begin
  if auth.uid() is null then raise exception 'Giriş yapmalısın.'; end if;
  select * into inv from public.community_invites where id = invite_id and user_id = auth.uid() and status = 'pending';
  if inv.id is null then raise exception 'Davet bulunamadı veya zaten yanıtlanmış.'; end if;

  update public.community_invites
  set status = case when accept then 'accepted' else 'declined' end
  where id = invite_id;

  if accept then
    select conversation_id into conv_id from public.communities where id = inv.community_id;
    insert into public.community_members (community_id, user_id)
    values (inv.community_id, auth.uid()) on conflict do nothing;
    if conv_id is not null then
      insert into public.conversation_members (conversation_id, user_id)
      values (conv_id, auth.uid()) on conflict do nothing;
    end if;
  end if;
end;
$$;

create or replace function public.leave_community(target_community uuid)
returns void language plpgsql security definer set search_path = public
as $$
declare conv_id uuid;
begin
  if auth.uid() is null then raise exception 'Giriş yapmalısın.'; end if;
  select conversation_id into conv_id from public.communities where id = target_community;

  delete from public.community_members
  where community_id = target_community and user_id = auth.uid();

  if conv_id is not null then
    delete from public.conversation_members
    where conversation_id = conv_id and user_id = auth.uid();
  end if;
end;
$$;

create or replace function public.delete_community(target_community uuid)
returns void language plpgsql security definer set search_path = public
as $$
begin
  if auth.uid() is null then raise exception 'Giriş yapmalısın.'; end if;
  if not exists (select 1 from public.communities where id = target_community and created_by = auth.uid()) then
    raise exception 'Yalnızca kurucu topluluğu silebilir.';
  end if;
  delete from public.communities where id = target_community;
end;
$$;

create or replace function public.remove_community_member(target_community uuid, target_user uuid)
returns void language plpgsql security definer set search_path = public
as $$
declare conv_id uuid;
begin
  if auth.uid() is null then raise exception 'Giriş yapmalısın.'; end if;
  if not public.is_community_admin(target_community) then raise exception 'Yetkin yok.'; end if;
  if target_user = auth.uid() then raise exception 'Kendini çıkarmak için ayrıl seçeneğini kullan.'; end if;
  select conversation_id into conv_id from public.communities where id = target_community;

  delete from public.community_members
  where community_id = target_community and user_id = target_user;

  if conv_id is not null then
    delete from public.conversation_members
    where conversation_id = conv_id and user_id = target_user;
  end if;
end;
$$;

revoke all on function public.create_community(text, text, text, text) from public;
revoke all on function public.join_community(uuid) from public;
revoke all on function public.leave_community(uuid) from public;
revoke all on function public.remove_community_member(uuid, uuid) from public;
revoke all on function public.request_join_community(uuid) from public;
revoke all on function public.decide_join_request(uuid, boolean) from public;
revoke all on function public.invite_community_member(uuid, text) from public;
revoke all on function public.respond_community_invite(uuid, boolean) from public;
revoke all on function public.delete_community(uuid) from public;
grant execute on function public.create_community(text, text, text, text) to authenticated;
grant execute on function public.join_community(uuid) to authenticated;
grant execute on function public.leave_community(uuid) to authenticated;
grant execute on function public.remove_community_member(uuid, uuid) to authenticated;
grant execute on function public.request_join_community(uuid) to authenticated;
grant execute on function public.decide_join_request(uuid, boolean) to authenticated;
grant execute on function public.invite_community_member(uuid, text) to authenticated;
grant execute on function public.respond_community_invite(uuid, boolean) to authenticated;
grant execute on function public.delete_community(uuid) to authenticated;

notify pgrst, 'reload schema';
