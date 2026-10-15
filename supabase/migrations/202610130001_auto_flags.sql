-- Otomatik içerik yakalama: şüpheli metin/medyaları admin kuyruğuna düşürür.
-- Tarama veritabanı trigger'ıyla yapılır; istemci atlatması mümkün değildir.

create table if not exists public.flagged_terms (
  term text primary key,
  added_at timestamptz not null default now()
);

-- Başlangıç listesi; admin SQL ile ekleme/çıkarma yapabilir.
insert into public.flagged_terms (term) values
  ('kumarhane'), ('bahis sitesi'), ('bedava coin'), ('airdrop'), ('telegramdan yaz'),
  ('satılık hesap'), ('organ sat'), ('intihar et'), ('kendini öldür'), ('kendini oldur'),
  ('enjekte'), ('uyusturucu sat'), ('uyuşturucu sat'), ('eskort'), ('escort'),
  ('amk'), ('aq'), ('orospu'), ('piç'), ('sikerim'), ('yarrak'), ('amina'),
  ('nazi'), ('soykırım'), ('soykirim')
on conflict (term) do nothing;

create table if not exists public.content_flags (
  id uuid primary key default gen_random_uuid(),
  target_type text not null check (target_type in ('post', 'comment', 'message')),
  target_id text not null,
  target_author_id uuid references auth.users(id) on delete cascade,
  source text not null default 'auto' check (source in ('auto', 'media', 'admin')),
  matched_terms text[] not null default '{}',
  excerpt text not null default '' check (length(excerpt) <= 800),
  status text not null default 'pending' check (status in ('pending', 'resolved', 'dismissed')),
  reviewed_by uuid references auth.users(id) on delete set null,
  reviewed_at timestamptz,
  created_at timestamptz not null default now()
);
create index if not exists content_flags_status_created_idx
  on public.content_flags(status, created_at desc);
-- Aynı içerik tekrar tekrar kuyruğa düşmesin (yalnızca bekleyenler için)
create unique index if not exists content_flags_pending_unique
  on public.content_flags(target_type, target_id) where status = 'pending';

alter table public.content_flags enable row level security;
alter table public.flagged_terms enable row level security;
revoke all on public.content_flags, public.flagged_terms from anon, authenticated;
grant select on public.content_flags to authenticated;

drop policy if exists "Admins can read content flags" on public.content_flags;
create policy "Admins can read content flags"
  on public.content_flags for select to authenticated
  using (public.is_current_user_admin());

-- Türkçe büyük/küçük harf farklılıklarını normalize eden tarama metni.
create or replace function public.flag_scan_text(t text)
returns text language sql immutable as $$
  select translate(lower(coalesce(t, '')), 'İı', 'ii');
$$;

-- Terim eşleşmesi varsa flag satırı aç; target_* kolonları her tabloda farklı adlandığı için parametreli.
create or replace function public.flag_if_suspicious(
  target_type text, target_id text, target_author uuid, haystack text
) returns void
language plpgsql security definer set search_path = ''
as $$
declare
  hits text[];
begin
  if haystack is null or length(trim(haystack)) = 0 then return; end if;
  select array_agg(t.term) into hits
  from public.flagged_terms t
  where position(t.term in public.flag_scan_text(haystack)) > 0;
  if hits is not null and array_length(hits, 1) > 0 then
    insert into public.content_flags (target_type, target_id, target_author_id, source, matched_terms, excerpt)
    values (target_type, target_id, target_author, 'auto', hits, left(haystack, 800))
    on conflict do nothing;
  end if;
end;
$$;

-- Medya eserleri metinle taranamayacağı için ayrıca "medya incelemesi" olarak kuyruğa düşer.
create or replace function public.flag_media_post(
  post_id uuid, post_author uuid
) returns void
language plpgsql security definer set search_path = ''
as $$
begin
  insert into public.content_flags (target_type, target_id, target_author_id, source, excerpt)
  values ('post', post_id::text, post_author, 'media', 'Yeni medya eseri — görsel/ses/video incelemesi.')
  on conflict do nothing;
end;
$$;

create or replace function public.trg_flag_post() returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
  perform public.flag_if_suspicious('post', new.id::text, new.author_id,
    concat_ws(' ', new.title, new.description, array_to_string(new.tags, ' ')));
  if new.media_url is not null and new.type in ('drawing', 'photo', 'video', 'music') then
    perform public.flag_media_post(new.id, new.author_id);
  end if;
  return new;
end;
$$;

create or replace function public.trg_flag_comment() returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
  perform public.flag_if_suspicious('comment', new.id::text, new.author_id, new.body);
  return new;
end;
$$;

create or replace function public.trg_flag_message() returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
  perform public.flag_if_suspicious('message', new.id::text, new.sender_id, new.body);
  return new;
end;
$$;

drop trigger if exists trg_flag_post on public.posts;
create trigger trg_flag_post after insert or update of title, description, tags on public.posts
  for each row execute function public.trg_flag_post();

drop trigger if exists trg_flag_comment on public.comments;
create trigger trg_flag_comment after insert or update of body on public.comments
  for each row execute function public.trg_flag_comment();

drop trigger if exists trg_flag_message on public.messages;
create trigger trg_flag_message after insert on public.messages
  for each row execute function public.trg_flag_message();

-- Admin işlemi: içeriği kaldır / kullanıcıyı kısıtla / reddet.
create or replace function public.admin_handle_flag(
  flag_id uuid,
  moderation_action text,
  action_notes text default ''
) returns void
language plpgsql security definer set search_path = ''
as $$
declare
  flag_row public.content_flags%rowtype;
begin
  if not public.is_current_user_admin() then raise exception 'Yönetici yetkisi gerekli.' using errcode = '42501'; end if;
  if moderation_action not in ('resolve', 'dismiss', 'remove_content', 'suspend_user', 'restore_user') then
    raise exception 'Yönetim işlemi geçersiz.';
  end if;
  if length(coalesce(action_notes, '')) > 1000 then raise exception 'Not en fazla 1000 karakter olabilir.'; end if;

  select * into flag_row from public.content_flags f where f.id = flag_id for update;
  if not found then raise exception 'Flag bulunamadı.'; end if;

  if moderation_action = 'remove_content' then
    if flag_row.target_type = 'post' then
      delete from public.posts where id = flag_row.target_id::uuid;
    elsif flag_row.target_type = 'comment' then
      delete from public.comments where id = flag_row.target_id::bigint;
    else
      delete from public.messages where id = flag_row.target_id::uuid;
    end if;
  elsif moderation_action = 'suspend_user' and flag_row.target_author_id is not null then
    update public.profiles set is_suspended = true where id = flag_row.target_author_id;
  elsif moderation_action = 'restore_user' and flag_row.target_author_id is not null then
    update public.profiles set is_suspended = false where id = flag_row.target_author_id;
  end if;

  update public.content_flags
  set status = case when moderation_action = 'dismiss' then 'dismissed' else 'resolved' end,
      reviewed_by = auth.uid(), reviewed_at = now()
  where id = flag_row.id;

  insert into public.moderation_actions(admin_id, report_id, action, target_type, target_id, notes)
  values(auth.uid(), null, moderation_action, 'flag:' || flag_row.target_type, flag_row.target_id, trim(coalesce(action_notes, '')));
end;
$$;
revoke all on function public.admin_handle_flag(uuid, text, text) from public, anon;
grant execute on function public.admin_handle_flag(uuid, text, text) to authenticated;

-- Admin sitede gezinirken bir içeriği doğrudan inceleme kuyruğuna alabilir.
-- Hedef: 'post' (uuid) | 'comment' (bigint) | 'message' (uuid)
alter table public.content_flags drop constraint if exists content_flags_source_check;
alter table public.content_flags add constraint content_flags_source_check
  check (source in ('auto', 'media', 'admin'));

create or replace function public.admin_flag_content(target_type text, target_id text)
returns uuid
language plpgsql security definer set search_path = ''
as $$
declare
  author uuid;
  snippet text;
  new_flag uuid;
begin
  if not public.is_current_user_admin() then raise exception 'Yönetici yetkisi gerekli.' using errcode = '42501'; end if;
  if target_type not in ('post', 'comment', 'message') then raise exception 'Tür geçersiz.'; end if;

  if target_type = 'post' then
    select p.author_id, left(concat_ws(' ', p.title, p.description), 800)
      into author, snippet from public.posts p where p.id = target_id::uuid;
  elsif target_type = 'comment' then
    select c.author_id, left(c.body, 800)
      into author, snippet from public.comments c where c.id = target_id::bigint;
  else
    select m.sender_id, left(m.body, 800)
      into author, snippet from public.messages m where m.id = target_id::uuid;
  end if;
  if author is null then raise exception 'İçerik bulunamadı.'; end if;

  insert into public.content_flags (target_type, target_id, target_author_id, source, excerpt)
  values (target_type, target_id, author, 'admin', coalesce(snippet, 'Yönetici incelemeye aldı.'))
  on conflict do nothing
  returning id into new_flag;

  return new_flag; -- null dönerse zaten bekleyen bir flag var
end;
$$;
revoke all on function public.admin_flag_content(text, text) from public, anon;
grant execute on function public.admin_flag_content(text, text) to authenticated;

notify pgrst, 'reload schema';
