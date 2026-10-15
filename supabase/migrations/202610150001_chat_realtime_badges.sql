-- Sohbet realtime + mesaj düzenleme/silme + tepkiler + rozet bildirimleri +
-- öne çıkan rozet + rozet nadirlik istatistikleri.
-- 202610140004_name_change_guards.sql sonrasında çalıştırılır.

-- 1) Mesaj düzenleme / yumuşak silme kolonları
alter table public.messages add column if not exists edited_at timestamptz;
alter table public.messages add column if not exists deleted_at timestamptz;
grant update (body, edited_at, deleted_at, read_at, delivered_at) on public.messages to authenticated;

-- Gönderen kendi mesajını düzenleyebilir/silebilir (read_at politikası ayrıca vardır;
-- permissive politikalar OR ile birleşir).
drop policy if exists "Senders can edit own messages" on public.messages;
create policy "Senders can edit own messages"
  on public.messages for update to authenticated
  using (sender_id = auth.uid())
  with check (sender_id = auth.uid());

-- 2) Mesaj tepkileri
create table if not exists public.message_reactions (
  message_id uuid not null references public.messages(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  emoji text not null check (emoji in ('❤️', '😂', '👍', '😮', '🔥')),
  created_at timestamptz not null default now(),
  primary key (message_id, user_id, emoji)
);
alter table public.message_reactions enable row level security;
grant select, insert, delete on public.message_reactions to authenticated;

drop policy if exists "Members read reactions" on public.message_reactions;
create policy "Members read reactions"
  on public.message_reactions for select to authenticated
  using (exists (select 1 from public.messages m
    where m.id = message_id and public.is_conversation_member(m.conversation_id)));

drop policy if exists "Members add reactions" on public.message_reactions;
create policy "Members add reactions"
  on public.message_reactions for insert to authenticated
  with check (user_id = auth.uid() and exists (select 1 from public.messages m
    where m.id = message_id and public.is_conversation_member(m.conversation_id)));

drop policy if exists "Users remove own reactions" on public.message_reactions;
create policy "Users remove own reactions"
  on public.message_reactions for delete to authenticated
  using (user_id = auth.uid());

-- 3) Realtime yayını (Supabase Realtime aktifse)
do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    begin execute 'alter publication supabase_realtime add table public.messages';
    exception when duplicate_object then null; end;
    begin execute 'alter publication supabase_realtime add table public.message_reactions';
    exception when duplicate_object then null; end;
    begin execute 'alter publication supabase_realtime add table public.notifications';
    exception when duplicate_object then null; end;
  end if;
end $$;

-- 4) Rozet bildirimi: user_badges'e her yeni satırda 'badge' bildirimi düşer
alter table public.notifications drop constraint if exists notifications_type_check;
alter table public.notifications add constraint notifications_type_check
  check (type in ('like','comment','reply','friend_request','friend_accept','message','follow','badge'));
alter table public.notifications add column if not exists badge_key text;

create or replace function public.notify_on_badge()
returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
  insert into public.notifications (user_id, actor_id, type, badge_key)
    values (new.user_id, new.user_id, 'badge', new.badge_key);
  return new;
end;
$$;
revoke all on function public.notify_on_badge() from public;

drop trigger if exists trg_notify_badge on public.user_badges;
create trigger trg_notify_badge after insert on public.user_badges
  for each row execute function public.notify_on_badge();

-- 5) Öne çıkan rozet: sadece kazanılmış rozet seçilebilir
alter table public.profiles add column if not exists featured_badge text;
grant update (featured_badge) on public.profiles to authenticated;

create or replace function public.guard_featured_badge()
returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
  if new.featured_badge is not null
     and not exists (select 1 from public.user_badges
                     where user_id = new.id and badge_key = new.featured_badge) then
    raise exception 'Öne çıkaracağın rozet sende yok.';
  end if;
  return new;
end;
$$;
revoke all on function public.guard_featured_badge() from public;

drop trigger if exists trg_guard_featured_badge on public.profiles;
create trigger trg_guard_featured_badge before update on public.profiles
  for each row when (old.featured_badge is distinct from new.featured_badge)
  execute function public.guard_featured_badge();

-- 6) Rozet nadirliği: her rozetten kaç kişide var + toplam kullanıcı
create or replace function public.badge_stats()
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare counts jsonb; total bigint;
begin
  select coalesce(jsonb_object_agg(badge_key, c), '{}'::jsonb) into counts
    from (select badge_key, count(*) as c from public.user_badges group by badge_key) s;
  select count(*) into total from public.profiles;
  return jsonb_build_object('counts', counts, 'users', total);
end;
$$;
revoke all on function public.badge_stats() from public;
grant execute on function public.badge_stats() to authenticated;

notify pgrst, 'reload schema';
