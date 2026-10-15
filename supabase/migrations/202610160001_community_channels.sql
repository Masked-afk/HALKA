-- Topluluk kanalları (Discord modeli): topluluk başına birden fazla isimli
-- sohbet kanalı + yöneticilerin sabitleyebildiği mesajlar.
-- 202610150004_admin_badge_edit.sql sonrasında çalıştırılır.

-- 1) Üyelik yardımcısı
create or replace function public.is_community_member(target uuid)
returns boolean language sql stable security definer set search_path = ''
as $$
  select exists (
    select 1 from public.community_members m
    where m.community_id = target and m.user_id = auth.uid()
  );
$$;
revoke all on function public.is_community_member(uuid) from public;
grant execute on function public.is_community_member(uuid) to authenticated;

-- 2) Kanallar
create table if not exists public.community_channels (
  id uuid primary key default gen_random_uuid(),
  community_id uuid not null references public.communities(id) on delete cascade,
  name text not null check (length(btrim(name)) between 1 and 40),
  position int not null default 0,
  created_at timestamptz not null default now()
);
create unique index if not exists community_channels_name_unique
  on public.community_channels (community_id, lower(name));
create index if not exists community_channels_community_idx
  on public.community_channels (community_id, position);

alter table public.community_channels enable row level security;
grant select, insert, delete on public.community_channels to authenticated;
grant update (name, position) on public.community_channels to authenticated;

drop policy if exists "Members read channels" on public.community_channels;
create policy "Members read channels"
  on public.community_channels for select to authenticated
  using (public.is_community_member(community_id));

drop policy if exists "Admins create channels" on public.community_channels;
create policy "Admins create channels"
  on public.community_channels for insert to authenticated
  with check (
    public.is_community_admin(community_id)
    or exists (select 1 from public.communities c
      where c.id = community_id and c.created_by = auth.uid())
  );

drop policy if exists "Admins update channels" on public.community_channels;
create policy "Admins update channels"
  on public.community_channels for update to authenticated
  using (public.is_community_admin(community_id))
  with check (public.is_community_admin(community_id));

drop policy if exists "Admins delete channels" on public.community_channels;
create policy "Admins delete channels"
  on public.community_channels for delete to authenticated
  using (
    public.is_community_admin(community_id)
    or exists (select 1 from public.communities c
      where c.id = community_id and c.created_by = auth.uid())
  );

-- 3) Kanal mesajları (sabitleme: pinned_by doluysa sabitlenmiş)
create table if not exists public.community_channel_messages (
  id uuid primary key default gen_random_uuid(),
  channel_id uuid not null references public.community_channels(id) on delete cascade,
  sender_id uuid not null references auth.users(id) on delete cascade,
  body text not null check (length(btrim(body)) between 1 and 1000),
  pinned_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now()
);
create index if not exists community_channel_messages_channel_idx
  on public.community_channel_messages (channel_id, created_at);

alter table public.community_channel_messages enable row level security;
grant select, insert, delete on public.community_channel_messages to authenticated;
grant update (pinned_by) on public.community_channel_messages to authenticated;

drop policy if exists "Members read channel messages" on public.community_channel_messages;
create policy "Members read channel messages"
  on public.community_channel_messages for select to authenticated
  using (exists (
    select 1 from public.community_channels ch
    where ch.id = channel_id and public.is_community_member(ch.community_id)
  ));

drop policy if exists "Members send channel messages" on public.community_channel_messages;
create policy "Members send channel messages"
  on public.community_channel_messages for insert to authenticated
  with check (
    sender_id = auth.uid()
    and exists (
      select 1 from public.community_channels ch
      where ch.id = channel_id and public.is_community_member(ch.community_id)
    )
  );

drop policy if exists "Senders or admins delete channel messages" on public.community_channel_messages;
create policy "Senders or admins delete channel messages"
  on public.community_channel_messages for delete to authenticated
  using (
    sender_id = auth.uid()
    or exists (
      select 1 from public.community_channels ch
      where ch.id = channel_id and public.is_community_admin(ch.community_id)
    )
  );

drop policy if exists "Admins pin channel messages" on public.community_channel_messages;
create policy "Admins pin channel messages"
  on public.community_channel_messages for update to authenticated
  using (exists (
    select 1 from public.community_channels ch
    where ch.id = channel_id and public.is_community_admin(ch.community_id)
  ))
  with check (exists (
    select 1 from public.community_channels ch
    where ch.id = channel_id and public.is_community_admin(ch.community_id)
  ));

-- 4) Yeni topluluklarda 'genel' kanalı otomatik kur
create or replace function public.seed_community_default_channel()
returns trigger language plpgsql security definer set search_path = ''
as $$
begin
  insert into public.community_channels (community_id, name, position)
    values (new.id, 'genel', 0);
  return new;
end;
$$;
revoke all on function public.seed_community_default_channel() from public;

drop trigger if exists trg_seed_community_channel on public.communities;
create trigger trg_seed_community_channel after insert on public.communities
  for each row execute function public.seed_community_default_channel();

-- Mevcut topluluklara 'genel' kanalı ekle
insert into public.community_channels (community_id, name, position)
select c.id, 'genel', 0
from public.communities c
where not exists (
  select 1 from public.community_channels ch where ch.community_id = c.id
);

-- 5) created_at koruması + otomatik flag taraması
drop trigger if exists trg_enforce_created_at on public.community_channels;
create trigger trg_enforce_created_at before insert or update on public.community_channels
  for each row execute function public.enforce_created_at();
drop trigger if exists trg_enforce_created_at on public.community_channel_messages;
create trigger trg_enforce_created_at before insert or update on public.community_channel_messages
  for each row execute function public.enforce_created_at();

create or replace function public.trg_flag_channel_message() returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
  perform public.flag_if_suspicious('message', new.id::text, new.sender_id, new.body);
  return new;
end;
$$;
drop trigger if exists trg_flag_channel_message on public.community_channel_messages;
create trigger trg_flag_channel_message after insert on public.community_channel_messages
  for each row execute function public.trg_flag_channel_message();

-- 6) Realtime yayını (varsa)
do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    begin execute 'alter publication supabase_realtime add table public.community_channel_messages';
    exception when duplicate_object then null; end;
  end if;
end $$;

notify pgrst, 'reload schema';
