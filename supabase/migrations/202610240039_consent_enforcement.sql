-- Belge onayının server tarafı zorunluluğu: profiles.consent_v +
-- consent_v NULL olan hesaplar posts/comments yazamaz.
-- 202610240038_dergi_and_chapter_like_notify.sql sonrasında çalıştırılır.

alter table public.profiles
  add column if not exists consent_v int;

-- mevcut kullanıcılar kapıyı geçmiş sayılır
update public.profiles set consent_v = 1 where consent_v is null;

create or replace function public.require_consent()
returns trigger
language plpgsql security definer
set search_path = ''
as $$
begin
  if (select p.consent_v from public.profiles p where p.id = new.author_id) is null
     and not exists (
       select 1 from public.profiles p
       where p.id = new.author_id and p.consent_v >= 1
     ) then
    raise exception 'consent_required';
  end if;
  return new;
end;
$$;

drop trigger if exists trg_consent_posts on public.posts;
create trigger trg_consent_posts
  before insert on public.posts
  for each row execute function public.require_consent();

drop trigger if exists trg_consent_comments on public.comments;
create trigger trg_consent_comments
  before insert on public.comments
  for each row execute function public.require_consent();

notify pgrst, 'reload schema';
