-- Özel rozetler: admin tarafından verilen rozetler + içerik tabanlı gizli başarımlar.
-- 202610140001_badge_system.sql sonrasında çalıştırılır.

-- 1) Admin tarafından verilen özel rozet tanımları
create table if not exists public.custom_badges (
  badge_key text primary key,
  name text not null,
  description text not null default '',
  icon text not null default '✦',
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now()
);
alter table public.custom_badges enable row level security;
revoke all on public.custom_badges from anon, authenticated;
grant select on public.custom_badges to authenticated;

drop policy if exists "Custom badges readable" on public.custom_badges;
create policy "Custom badges readable"
  on public.custom_badges for select to authenticated
  using (true);

-- 2) Admin rozet verme / geri alma RPC'leri
--    Kullanıcı adı çözümleme burada yapılır; doğrudan profiles sorgusu
--    gizli profillerde RLS'e takılırdı.
drop function if exists public.admin_grant_badge(uuid, text, text, text);
create or replace function public.admin_grant_badge(target_username text, badge_name text, badge_desc text default '', badge_icon text default '✦')
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare k text; uid uuid;
begin
  if not public.is_current_user_admin() then
    raise exception 'Yönetici yetkisi gerekli.' using errcode = '42501';
  end if;
  select id into uid from public.profiles
    where username = lower(btrim(regexp_replace(coalesce(target_username, ''), '^@+', '')));
  if uid is null then
    raise exception 'Bu kullanıcı adıyla bir hesap bulunamadı.';
  end if;
  if btrim(coalesce(badge_name, '')) = '' then
    raise exception 'Rozet adı boş olamaz.';
  end if;
  k := 'ozel_' || replace(gen_random_uuid()::text, '-', '');
  insert into public.custom_badges (badge_key, name, description, icon, created_by)
    values (k, left(btrim(badge_name), 40), left(btrim(coalesce(badge_desc, '')), 140), coalesce(nullif(btrim(coalesce(badge_icon, '')), ''), '✦'), auth.uid());
  insert into public.user_badges (user_id, badge_key) values (uid, k) on conflict do nothing;
  return jsonb_build_object('ok', true, 'badge_key', k);
end;
$$;
revoke all on function public.admin_grant_badge(text, text, text, text) from public;
grant execute on function public.admin_grant_badge(text, text, text, text) to authenticated;

create or replace function public.admin_revoke_badge(target_user uuid, b_key text)
returns jsonb
language plpgsql security definer set search_path = ''
as $$
begin
  if not public.is_current_user_admin() then
    raise exception 'Yönetici yetkisi gerekli.' using errcode = '42501';
  end if;
  delete from public.user_badges where user_id = target_user and badge_key = b_key;
  return jsonb_build_object('ok', true);
end;
$$;
revoke all on function public.admin_revoke_badge(uuid, text) from public;
grant execute on function public.admin_revoke_badge(uuid, text) to authenticated;

-- 3) Bir profilin kazandığı özel rozetlerin tanımları (raf gösterimi için)
create or replace function public.user_special_badges(target_user uuid)
returns jsonb
language plpgsql security definer set search_path = ''
as $$
begin
  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'key', cb.badge_key,
      'name', cb.name,
      'desc', cb.description,
      'icon', cb.icon,
      'earned_at', ub.earned_at
    ) order by ub.earned_at)
    from public.custom_badges cb
    join public.user_badges ub on ub.badge_key = cb.badge_key
    where ub.user_id = target_user
  ), '[]'::jsonb);
end;
$$;
revoke all on function public.user_special_badges(uuid) from public;
grant execute on function public.user_special_badges(uuid) to anon, authenticated;

-- 4) "Senmi?" gizli rozeti: yorumlarda, yanıtlarda, topluluk/grup/birebir
--    sohbette mesajın tamamı "benmi?"/"Benmi?"/"benmı?"/"Benmı?" olan kazanır.
create or replace function public.check_special_text_badge()
returns trigger
language plpgsql security definer set search_path = ''
as $$
declare uid uuid; txt text;
begin
  uid := coalesce((to_jsonb(new) ->> 'author_id')::uuid, (to_jsonb(new) ->> 'sender_id')::uuid);
  txt := btrim(coalesce(to_jsonb(new) ->> 'body', ''));
  if uid is not null and txt in ('benmi?', 'Benmi?', 'benmı?', 'Benmı?') then
    insert into public.user_badges (user_id, badge_key) values (uid, 'senmi') on conflict do nothing;
  end if;
  return new;
end;
$$;
revoke all on function public.check_special_text_badge() from public;

drop trigger if exists trg_special_text_badge on public.comments;
create trigger trg_special_text_badge after insert on public.comments
  for each row execute function public.check_special_text_badge();

drop trigger if exists trg_special_text_badge on public.messages;
create trigger trg_special_text_badge after insert on public.messages
  for each row execute function public.check_special_text_badge();

-- 5) Kullanıcı adı tekilliği: mevcut kopyaları ayıkla, sonra unique index kur.
with dupes as (
  select id, username, row_number() over (partition by username order by id) as rn
  from public.profiles
)
update public.profiles p
set username = d.username || '_' || substr(d.id::text, 1, 4)
from dupes d
where d.rn > 1 and p.id = d.id;

create unique index if not exists profiles_username_unique on public.profiles (username);

notify pgrst, 'reload schema';
