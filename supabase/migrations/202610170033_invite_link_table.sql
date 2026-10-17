-- Davet kodunu communities.invite_code kolonundan ayrı tabloya taşır.
-- 'Sadece davet' topluluklarda kodun REST üzerinden sızmasını önler;
-- yalnızca yöneticiler okur, katılım security-definer RPC üzerinden.
-- 202610170032_social_depth.sql sonrasında çalıştırılır.

create table if not exists public.community_invite_links (
  community_id uuid primary key references public.communities(id) on delete cascade,
  code text not null unique default upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 8)),
  created_at timestamptz not null default now()
);
alter table public.community_invite_links enable row level security;
grant select on public.community_invite_links to authenticated;

drop policy if exists "Admins read invite link" on public.community_invite_links;
create policy "Admins read invite link"
  on public.community_invite_links for select to authenticated
  using (public.is_community_admin(community_id)
    or exists (select 1 from public.communities c
      where c.id = community_id and c.created_by = auth.uid()));

-- Mevcut kodları taşı, olmayan topluluklara üret
insert into public.community_invite_links (community_id, code)
select c.id,
       coalesce(c.invite_code, upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 8)))
from public.communities c
where not exists (select 1 from public.community_invite_links l where l.community_id = c.id)
on conflict (community_id) do nothing;

create or replace function public.join_community_by_code(p_code text)
returns uuid language plpgsql security definer set search_path = ''
as $$
declare
  v_id uuid;
begin
  if auth.uid() is null then raise exception 'Giriş yapmalısın.'; end if;
  select l.community_id into v_id from public.community_invite_links l
    where l.code = upper(btrim(p_code));
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
  insert into public.community_invite_links (community_id, code)
    values (p_community, v_code)
    on conflict (community_id) do update set code = excluded.code;
  return v_code;
end;
$$;
revoke all on function public.rotate_invite_code(uuid) from public;
grant execute on function public.rotate_invite_code(uuid) to authenticated;

alter table public.communities drop column if exists invite_code;

notify pgrst, 'reload schema';
