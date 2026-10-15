-- Hata bildirimi: kullanıcı açıklama + ekran görüntüsü gönderir, admin panelinde incelenir.
-- Ayrıca admin paneli için site istatistikleri RPC'si.

create table if not exists public.bug_reports (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  description text not null check (length(trim(description)) between 10 and 2000),
  screenshot_path text check (screenshot_path is null or length(screenshot_path) <= 500),
  status text not null default 'open' check (status in ('open', 'resolved', 'dismissed')),
  reviewed_by uuid references auth.users(id) on delete set null,
  reviewed_at timestamptz,
  created_at timestamptz not null default now()
);
create index if not exists bug_reports_status_created_idx
  on public.bug_reports(status, created_at desc);

alter table public.bug_reports enable row level security;
revoke all on public.bug_reports from anon, authenticated;
grant select on public.bug_reports to authenticated;

drop policy if exists "Admins and owners read bug reports" on public.bug_reports;
create policy "Admins and owners read bug reports"
  on public.bug_reports for select to authenticated
  using (user_id = auth.uid() or public.is_current_user_admin());

-- Ekran görüntüleri için özel bucket (sahibi ve admin görebilir)
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('bug-reports', 'bug-reports', false, 5242880, array['image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do update set
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "Bug screenshot owner or admin read" on storage.objects;
create policy "Bug screenshot owner or admin read"
  on storage.objects for select to authenticated
  using (
    bucket_id = 'bug-reports'
    and ((storage.foldername(name))[1] = auth.uid()::text or public.is_current_user_admin())
  );

drop policy if exists "Bug screenshot owner upload" on storage.objects;
create policy "Bug screenshot owner upload"
  on storage.objects for insert to authenticated
  with check (bucket_id = 'bug-reports' and (storage.foldername(name))[1] = auth.uid()::text);

drop policy if exists "Bug screenshot owner delete" on storage.objects;
create policy "Bug screenshot owner delete"
  on storage.objects for delete to authenticated
  using (bucket_id = 'bug-reports' and (storage.foldername(name))[1] = auth.uid()::text);

-- Bildirim gönderme RPC'si: yol yalnızca kendi klasörüne ait olabilir.
create or replace function public.submit_bug_report(bug_description text, bug_screenshot_path text default null)
returns uuid
language plpgsql security definer set search_path = ''
as $$
declare
  new_id uuid;
begin
  if auth.uid() is null then raise exception 'Giriş yapmalısın.' using errcode = '28000'; end if;
  if length(trim(coalesce(bug_description, ''))) < 10 then
    raise exception 'Açıklama en az 10 karakter olmalı.';
  end if;
  if length(coalesce(bug_description, '')) > 2000 then
    raise exception 'Açıklama en fazla 2000 karakter olabilir.';
  end if;
  if bug_screenshot_path is not null and bug_screenshot_path not like auth.uid()::text || '/%' then
    raise exception 'Geçersiz görüntü yolu.';
  end if;

  insert into public.bug_reports (user_id, description, screenshot_path)
  values (auth.uid(), trim(bug_description), bug_screenshot_path)
  returning id into new_id;
  return new_id;
end;
$$;
revoke all on function public.submit_bug_report(text, text) from public, anon;
grant execute on function public.submit_bug_report(text, text) to authenticated;

-- Admin işlemi: çözüldü / reddedildi
create or replace function public.admin_handle_bug_report(
  bug_report_id uuid,
  moderation_action text,
  action_notes text default ''
) returns void
language plpgsql security definer set search_path = ''
as $$
begin
  if not public.is_current_user_admin() then raise exception 'Yönetici yetkisi gerekli.' using errcode = '42501'; end if;
  if moderation_action not in ('resolve', 'dismiss') then raise exception 'Yönetim işlemi geçersiz.'; end if;
  if length(coalesce(action_notes, '')) > 1000 then raise exception 'Not en fazla 1000 karakter olabilir.'; end if;

  update public.bug_reports
  set status = case when moderation_action = 'dismiss' then 'dismissed' else 'resolved' end,
      reviewed_by = auth.uid(), reviewed_at = now()
  where id = bug_report_id;
  if not found then raise exception 'Bildirim bulunamadı.'; end if;

  insert into public.moderation_actions(admin_id, report_id, action, target_type, target_id, notes)
  values(auth.uid(), null, moderation_action, 'bug_report', bug_report_id::text, trim(coalesce(action_notes, '')));
end;
$$;
revoke all on function public.admin_handle_bug_report(uuid, text, text) from public, anon;
grant execute on function public.admin_handle_bug_report(uuid, text, text) to authenticated;

-- Admin paneli istatistikleri
create or replace function public.admin_stats()
returns jsonb
language plpgsql stable security definer set search_path = ''
as $$
declare result jsonb;
begin
  if not public.is_current_user_admin() then raise exception 'Yönetici yetkisi gerekli.' using errcode = '42501'; end if;
  select jsonb_build_object(
    'users', (select count(*) from public.profiles),
    'suspended_users', (select count(*) from public.profiles where is_suspended),
    'posts', (select count(*) from public.posts),
    'comments', (select count(*) from public.comments),
    'communities', (select count(*) from public.communities),
    'open_reports', (select count(*) from public.content_reports where status = 'open'),
    'pending_flags', (select count(*) from public.content_flags where status = 'pending'),
    'open_bug_reports', (select count(*) from public.bug_reports where status = 'open')
  ) into result;
  return result;
end;
$$;
revoke all on function public.admin_stats() from public, anon;
grant execute on function public.admin_stats() to authenticated;

notify pgrst, 'reload schema';
