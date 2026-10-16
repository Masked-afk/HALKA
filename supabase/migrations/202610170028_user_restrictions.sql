-- Uye bazli kisitlar: yorum banı / yayin banı (sureli veya suresiz).
-- Tam hesap kisitlamasindan (is_suspended) daha hafif yaptirim.

create table if not exists public.user_restrictions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  kind text not null check (kind in ('post','comment')),
  until timestamptz,               -- null = suresiz
  reason text check (reason is null or length(reason) <= 500),
  set_by uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  unique (user_id, kind)
);

alter table public.user_restrictions enable row level security;

-- Adminler hepsini, kullanici kendi kisitini gorur
drop policy if exists user_restrictions_select on public.user_restrictions;
create policy user_restrictions_select on public.user_restrictions
  for select to authenticated
  using (user_id = auth.uid() or public.is_current_user_admin());
revoke insert, update, delete on public.user_restrictions from anon, authenticated;

create or replace function public.user_restricted(uid uuid, restriction_kind text)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.user_restrictions ur
    where ur.user_id = uid and ur.kind = restriction_kind
      and (ur.until is null or ur.until > now())
  );
$$;
revoke all on function public.user_restricted(uuid, text) from public;
grant execute on function public.user_restricted(uuid, text) to authenticated;

-- Yayın kisiti: eser olusturma engeli (taslak dahil)
drop policy if exists restriction_post_block on public.posts;
create policy restriction_post_block on public.posts
  as restrictive for insert to authenticated
  with check (not public.user_restricted(auth.uid(), 'post'));

-- Yorum kisiti
drop policy if exists restriction_comment_block on public.comments;
create policy restriction_comment_block on public.comments
  as restrictive for insert to authenticated
  with check (not public.user_restricted(auth.uid(), 'comment'));

-- moderation_actions turlerini genislet
alter table public.moderation_actions drop constraint if exists moderation_actions_action_check;
alter table public.moderation_actions add constraint moderation_actions_action_check
  check (action in ('resolve','dismiss','remove_content','suspend_user','restore_user','restrict','unrestrict'));

-- Admin RPC: kisit uygula (duration_hours null => suresiz) veya kaldir
create or replace function public.admin_set_restriction(
  target_user uuid, restriction_kind text,
  duration_hours int default null, reason_text text default null
)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if not public.is_current_user_admin() then
    raise exception 'Yetkin yok.' using errcode = '42501';
  end if;
  if restriction_kind not in ('post','comment') then
    raise exception 'Gecersiz kisit turu.' using errcode = '22023';
  end if;
  if target_user = auth.uid() then
    raise exception 'Kendine kisit uygulayamazsin.' using errcode = '22023';
  end if;
  insert into public.user_restrictions (user_id, kind, until, reason, set_by)
  values (target_user, restriction_kind,
          case when duration_hours is null or duration_hours <= 0 then null
               else now() + make_interval(hours => duration_hours) end,
          left(coalesce(reason_text, ''), 500), auth.uid())
  on conflict (user_id, kind) do update
    set until = excluded.until, reason = excluded.reason, set_by = excluded.set_by, created_at = now();
  insert into public.moderation_actions (admin_id, action, target_type, target_id, notes)
  values (auth.uid(), 'restrict', 'user', target_user::text,
          restriction_kind || ' kisiti' || coalesce(' — ' || left(reason_text, 200), ''));
end;
$$;
revoke all on function public.admin_set_restriction(uuid, text, int, text) from public;
grant execute on function public.admin_set_restriction(uuid, text, int, text) to authenticated;

create or replace function public.admin_clear_restriction(target_user uuid, restriction_kind text)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if not public.is_current_user_admin() then
    raise exception 'Yetkin yok.' using errcode = '42501';
  end if;
  delete from public.user_restrictions where user_id = target_user and kind = restriction_kind;
  insert into public.moderation_actions (admin_id, action, target_type, target_id, notes)
  values (auth.uid(), 'unrestrict', 'user', target_user::text, restriction_kind || ' kisiti kaldirildi');
end;
$$;
revoke all on function public.admin_clear_restriction(uuid, text) from public;
grant execute on function public.admin_clear_restriction(uuid, text) to authenticated;

notify pgrst, 'reload schema';
