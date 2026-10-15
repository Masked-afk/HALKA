-- Bildirim sistemi: beğeni, yorum, yanıt, arkadaşlık isteği/kabul ve mesajlar
-- için otomatik bildirim üretir.

create table if not exists public.notifications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  actor_id uuid references auth.users(id) on delete cascade,
  type text not null check (type in ('like','comment','reply','friend_request','friend_accept','message')),
  post_id uuid references public.posts(id) on delete cascade,
  comment_id bigint references public.comments(id) on delete cascade,
  conversation_id uuid references public.conversations(id) on delete cascade,
  friend_request_id uuid references public.friend_requests(id) on delete cascade,
  created_at timestamptz not null default now(),
  read_at timestamptz
);

create index if not exists notifications_user_unread_idx
  on public.notifications(user_id) where read_at is null;
create index if not exists notifications_user_created_idx
  on public.notifications(user_id, created_at desc);

alter table public.notifications enable row level security;
revoke all on public.notifications from anon, authenticated;
grant select, update, delete on public.notifications to authenticated;

drop policy if exists "Users can read own notifications" on public.notifications;
create policy "Users can read own notifications"
  on public.notifications for select to authenticated
  using (auth.uid() = user_id);

drop policy if exists "Users can update own notifications" on public.notifications;
create policy "Users can update own notifications"
  on public.notifications for update to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

drop policy if exists "Users can delete own notifications" on public.notifications;
create policy "Users can delete own notifications"
  on public.notifications for delete to authenticated
  using (auth.uid() = user_id);

-- Beğeni -> eser sahibine bildirim
create or replace function public.notify_on_like()
returns trigger language plpgsql security definer set search_path = '' as $$
declare target uuid;
begin
  select author_id into target from public.posts where id = new.post_id;
  if target is null or target = new.user_id then return new; end if;
  if exists (select 1 from public.notifications n
    where n.user_id = target and n.actor_id = new.user_id
      and n.type = 'like' and n.post_id = new.post_id and n.read_at is null) then
    return new;
  end if;
  insert into public.notifications (user_id, actor_id, type, post_id)
    values (target, new.user_id, 'like', new.post_id);
  return new;
end;
$$;

drop trigger if exists trg_notify_like on public.likes;
create trigger trg_notify_like after insert on public.likes
  for each row execute function public.notify_on_like();

-- Yorum -> eser sahibine; yanıt -> yorum sahibine bildirim
create or replace function public.notify_on_comment()
returns trigger language plpgsql security definer set search_path = '' as $$
declare target uuid;
begin
  if new.parent_comment_id is not null then
    select author_id into target from public.comments where id = new.parent_comment_id;
    if target is not null and target <> new.author_id then
      insert into public.notifications (user_id, actor_id, type, post_id, comment_id)
        values (target, new.author_id, 'reply', new.post_id, new.id);
    end if;
  end if;
  select author_id into target from public.posts where id = new.post_id;
  if target is not null and target <> new.author_id then
    insert into public.notifications (user_id, actor_id, type, post_id, comment_id)
      values (target, new.author_id, 'comment', new.post_id, new.id);
  end if;
  return new;
end;
$$;

drop trigger if exists trg_notify_comment on public.comments;
create trigger trg_notify_comment after insert on public.comments
  for each row execute function public.notify_on_comment();

-- Arkadaşlık isteği -> alıcıya; kabul -> gönderene bildirim
create or replace function public.notify_on_friend_request()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if tg_op = 'INSERT' then
    insert into public.notifications (user_id, actor_id, type, friend_request_id)
      values (new.receiver_id, new.sender_id, 'friend_request', new.id);
  elsif tg_op = 'UPDATE'
    and new.status = 'accepted' and old.status is distinct from 'accepted' then
    insert into public.notifications (user_id, actor_id, type, friend_request_id)
      values (new.sender_id, new.receiver_id, 'friend_accept', new.id);
  end if;
  return new;
end;
$$;

drop trigger if exists trg_notify_friend_request on public.friend_requests;
create trigger trg_notify_friend_request after insert or update on public.friend_requests
  for each row execute function public.notify_on_friend_request();

-- Mesaj -> sohbetteki diğer üyelere bildirim (okunmamış tek bildirimle sınırlı)
create or replace function public.notify_on_message()
returns trigger language plpgsql security definer set search_path = '' as $$
declare member record;
begin
  for member in
    select user_id from public.conversation_members
    where conversation_id = new.conversation_id and user_id <> new.sender_id
  loop
    if not exists (select 1 from public.notifications n
      where n.user_id = member.user_id and n.type = 'message'
        and n.conversation_id = new.conversation_id and n.read_at is null) then
      insert into public.notifications (user_id, actor_id, type, conversation_id)
        values (member.user_id, new.sender_id, 'message', new.conversation_id);
    end if;
  end loop;
  return new;
end;
$$;

drop trigger if exists trg_notify_message on public.messages;
create trigger trg_notify_message after insert on public.messages
  for each row execute function public.notify_on_message();

notify pgrst, 'reload schema';
