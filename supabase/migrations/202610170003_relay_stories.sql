-- Nöbetleşe hikâye: iki kullanıcının sırayla paragraf eklediği ortak yazı.
-- Sıra adaleti, katılımcı ve durum kontrolleri RPC'lerde; tablolara doğrudan
-- yazma kapalı (RLS grant yok), okuma herkese açık.
-- 202610170002_streak.sql sonrasında çalıştırılır.

-- 0) Bildirim tipine 'relay' ekle + relay_id kolonu
alter table public.notifications drop constraint if exists notifications_type_check;
alter table public.notifications add constraint notifications_type_check
  check (type in ('like','comment','reply','friend_request','friend_accept','message','follow','badge','new_post','relay'));
alter table public.notifications add column if not exists relay_id uuid;

-- 1) Tablolar
create table if not exists public.relay_stories (
  id uuid primary key default gen_random_uuid(),
  title text not null check (length(btrim(title)) between 1 and 80),
  host_id uuid not null references auth.users(id) on delete cascade,
  partner_id uuid not null references auth.users(id) on delete cascade,
  status text not null default 'active' check (status in ('active','finished')),
  turn_count int not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (host_id <> partner_id)
);

create table if not exists public.relay_turns (
  id uuid primary key default gen_random_uuid(),
  story_id uuid not null references public.relay_stories(id) on delete cascade,
  seq int not null,
  author_id uuid not null references auth.users(id) on delete cascade,
  body text not null check (length(btrim(body)) between 1 and 1200),
  created_at timestamptz not null default now(),
  unique (story_id, seq)
);
create index if not exists relay_turns_story_idx on public.relay_turns (story_id, seq);
create index if not exists relay_stories_updated_idx on public.relay_stories (updated_at desc);

alter table public.notifications drop constraint if exists notifications_relay_id_fkey;
alter table public.notifications add constraint notifications_relay_id_fkey
  foreign key (relay_id) references public.relay_stories(id) on delete cascade;

alter table public.relay_stories enable row level security;
alter table public.relay_turns enable row level security;

-- Sadece okuma açık; yazma yalnızca RPC üzerinden.
grant select on public.relay_stories to anon, authenticated;
grant select on public.relay_turns to anon, authenticated;

drop policy if exists "Anyone can read relay stories" on public.relay_stories;
create policy "Anyone can read relay stories"
  on public.relay_stories for select to anon, authenticated using (true);

drop policy if exists "Anyone can read relay turns" on public.relay_turns;
create policy "Anyone can read relay turns"
  on public.relay_turns for select to anon, authenticated using (true);

-- 2) RPC'ler
create or replace function public.relay_start(p_title text, p_partner uuid)
returns uuid
language plpgsql security definer set search_path = ''
as $$
declare
  v_id uuid;
begin
  if auth.uid() is null then raise exception 'Giriş yapmalısın.'; end if;
  if p_partner = auth.uid() then raise exception 'Kendinle nöbetleşe yazamazsın — bir ortak seç.'; end if;
  if not exists (select 1 from public.profiles where id = p_partner) then
    raise exception 'Kullanıcı bulunamadı.'; end if;
  if exists (select 1 from public.blocks
             where (blocker_id = auth.uid() and blocked_id = p_partner)
                or (blocker_id = p_partner and blocked_id = auth.uid())) then
    raise exception 'Bu kullanıcıyla nöbetleşe başlatılamaz.';
  end if;
  insert into public.relay_stories (title, host_id, partner_id)
    values (left(btrim(p_title), 80), auth.uid(), p_partner)
    returning id into v_id;
  insert into public.notifications (user_id, actor_id, type, relay_id)
    values (p_partner, auth.uid(), 'relay', v_id);
  return v_id;
end;
$$;
revoke all on function public.relay_start(text, uuid) from public;
grant execute on function public.relay_start(text, uuid) to authenticated;

create or replace function public.relay_add_turn(p_story uuid, p_body text)
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  v public.relay_stories%rowtype;
  v_last uuid;
  v_other uuid;
  v_seq int;
begin
  if auth.uid() is null then raise exception 'Giriş yapmalısın.'; end if;
  select * into v from public.relay_stories where id = p_story for update;
  if not found then raise exception 'Hikâye bulunamadı.'; end if;
  if v.status <> 'active' then raise exception 'Bu hikâye tamamlanmış.'; end if;
  if auth.uid() not in (v.host_id, v.partner_id) then
    raise exception 'Bu hikâyenin katılımcısı değilsin.'; end if;
  select author_id into v_last from public.relay_turns
    where story_id = p_story order by seq desc limit 1;
  if v_last = auth.uid() then
    raise exception 'Sıra sende değil — ortağının devam etmesini bekle.'; end if;
  v_seq := v.turn_count + 1;
  insert into public.relay_turns (story_id, seq, author_id, body)
    values (p_story, v_seq, auth.uid(), left(btrim(p_body), 1200));
  update public.relay_stories set turn_count = v_seq, updated_at = now() where id = p_story;
  v_other := case when v.host_id = auth.uid() then v.partner_id else v.host_id end;
  insert into public.notifications (user_id, actor_id, type, relay_id)
    values (v_other, auth.uid(), 'relay', p_story);
  return jsonb_build_object('ok', true, 'seq', v_seq);
end;
$$;
revoke all on function public.relay_add_turn(uuid, text) from public;
grant execute on function public.relay_add_turn(uuid, text) to authenticated;

create or replace function public.relay_finish(p_story uuid)
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  v public.relay_stories%rowtype;
begin
  select * into v from public.relay_stories where id = p_story for update;
  if not found then raise exception 'Hikâye bulunamadı.'; end if;
  if auth.uid() not in (v.host_id, v.partner_id) then
    raise exception 'Sadece katılımcılar hikâyeyi bitirebilir.'; end if;
  update public.relay_stories set status = 'finished', updated_at = now() where id = p_story;
  insert into public.notifications (user_id, actor_id, type, relay_id)
    values (case when v.host_id = auth.uid() then v.partner_id else v.host_id end,
            auth.uid(), 'relay', p_story);
  return jsonb_build_object('ok', true);
end;
$$;
revoke all on function public.relay_finish(uuid) from public;
grant execute on function public.relay_finish(uuid) to authenticated;

create or replace function public.relay_delete(p_story uuid)
returns jsonb
language plpgsql security definer set search_path = ''
as $$
begin
  if not exists (select 1 from public.relay_stories where id = p_story and host_id = auth.uid()) then
    raise exception 'Sadece başlatan silebilir.'; end if;
  delete from public.relay_stories where id = p_story;
  return jsonb_build_object('ok', true);
end;
$$;
revoke all on function public.relay_delete(uuid) from public;
grant execute on function public.relay_delete(uuid) to authenticated;

-- 3) Realtime yayını (ortak anında görsün)
do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    begin execute 'alter publication supabase_realtime add table public.relay_turns';
    exception when duplicate_object then null; end;
  end if;
end $$;

notify pgrst, 'reload schema';
