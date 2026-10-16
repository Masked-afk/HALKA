-- Birlikte okuyalim kulubu: bir eser secilir, uyeler bolum bolum ilerler.
-- Tartisma mevcut bolum yorumlari (comments.chapter_id) uzerinden yurur.

create table if not exists public.reading_clubs (
  id uuid primary key default gen_random_uuid(),
  post_id uuid not null references public.posts(id) on delete cascade,
  name text not null check (length(btrim(name)) between 1 and 120),
  created_by uuid not null references auth.users(id) on delete cascade,
  current_chapter int not null default 0 check (current_chapter >= 0),
  status text not null default 'active' check (status in ('active','finished')),
  created_at timestamptz not null default now()
);
create index if not exists reading_clubs_post_idx on public.reading_clubs (post_id, status);

create table if not exists public.reading_club_members (
  club_id uuid not null references public.reading_clubs(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  joined_at timestamptz not null default now(),
  primary key (club_id, user_id)
);

alter table public.reading_clubs enable row level security;
alter table public.reading_club_members enable row level security;

drop policy if exists reading_clubs_select on public.reading_clubs;
create policy reading_clubs_select on public.reading_clubs for select using (true);

drop policy if exists reading_clubs_insert on public.reading_clubs;
create policy reading_clubs_insert on public.reading_clubs
  for insert to authenticated with check (created_by = auth.uid());

drop policy if exists reading_clubs_update on public.reading_clubs;
create policy reading_clubs_update on public.reading_clubs
  for update to authenticated using (created_by = auth.uid());

drop policy if exists reading_clubs_delete on public.reading_clubs;
create policy reading_clubs_delete on public.reading_clubs
  for delete to authenticated using (created_by = auth.uid());

drop policy if exists club_members_select on public.reading_club_members;
create policy club_members_select on public.reading_club_members for select using (true);

drop policy if exists club_members_insert on public.reading_club_members;
create policy club_members_insert on public.reading_club_members
  for insert to authenticated with check (user_id = auth.uid());

drop policy if exists club_members_delete on public.reading_club_members;
create policy club_members_delete on public.reading_club_members
  for delete to authenticated using (user_id = auth.uid());

-- Kulup kuran otomatik uye olur
create or replace function public.club_creator_joins()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.reading_club_members (club_id, user_id) values (new.id, new.created_by)
  on conflict do nothing;
  return new;
end $$;

drop trigger if exists club_creator_joins_trg on public.reading_clubs;
create trigger club_creator_joins_trg
  after insert on public.reading_clubs
  for each row execute function public.club_creator_joins();
