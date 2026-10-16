-- Üretim meydan okumaları: admin süreli görev açar ("24 saatte 500 kelime" gibi),
-- üyeler pencere içinde yayınladıkları eseri gönderir; katılanlar rozet kazanır.
-- 202610170019_shared_lists.sql sonrasında çalıştırılır.

create table if not exists public.challenges (
  id uuid primary key default gen_random_uuid(),
  title text not null check (length(btrim(title)) between 2 and 80),
  prompt text check (prompt is null or length(prompt) <= 400),
  goal text check (goal is null or length(goal) <= 120),
  starts_at timestamptz not null default now(),
  ends_at timestamptz not null,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  check (ends_at > starts_at)
);
create index if not exists challenges_active_idx on public.challenges (ends_at, starts_at);

create table if not exists public.challenge_entries (
  challenge_id uuid not null references public.challenges(id) on delete cascade,
  post_id uuid not null references public.posts(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (challenge_id, post_id)
);
create index if not exists challenge_entries_challenge_idx on public.challenge_entries (challenge_id, created_at);
create index if not exists challenge_entries_user_idx on public.challenge_entries (user_id, created_at desc);

alter table public.challenges enable row level security;
alter table public.challenge_entries enable row level security;
grant select on public.challenges to anon, authenticated;
grant select, insert, delete on public.challenge_entries to authenticated;

drop policy if exists challenges_select on public.challenges;
create policy challenges_select on public.challenges
  for select to anon, authenticated using (true);

drop policy if exists challenges_admin_insert on public.challenges;
create policy challenges_admin_insert on public.challenges
  for insert to authenticated with check ((select public.is_current_user_admin()));

drop policy if exists challenges_admin_update on public.challenges;
create policy challenges_admin_update on public.challenges
  for update to authenticated using ((select public.is_current_user_admin()));

drop policy if exists challenges_admin_delete on public.challenges;
create policy challenges_admin_delete on public.challenges
  for delete to authenticated using ((select public.is_current_user_admin()));

drop policy if exists challenge_entries_select on public.challenge_entries;
create policy challenge_entries_select on public.challenge_entries
  for select using (true);

-- Katılım: girişli, kendi eseri, meydan okuma süresi içinde,
-- eser de pencere içinde yayınlanmış olmalı
drop policy if exists challenge_entries_insert on public.challenge_entries;
create policy challenge_entries_insert on public.challenge_entries
  for insert to authenticated with check (
    user_id = auth.uid()
    and exists (select 1 from public.posts p where p.id = post_id and p.author_id = auth.uid())
    and exists (
      select 1 from public.challenges ch
      join public.posts p2 on p2.id = post_id
      where ch.id = challenge_id
        and now() between ch.starts_at and ch.ends_at
        and p2.created_at between ch.starts_at and ch.ends_at
    )
  );

drop policy if exists challenge_entries_delete on public.challenge_entries;
create policy challenge_entries_delete on public.challenge_entries
  for delete to authenticated using (user_id = auth.uid());

-- Katılım rozeti: meydan_okuyucu
create or replace function public.award_challenge_badge()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.custom_badges (badge_key, name, description, icon)
  values ('meydan_okuyucu', 'Meydan Okuyucu', 'Bir üretim meydan okumasına katıldın', '⚡')
  on conflict (badge_key) do nothing;
  insert into public.user_badges (user_id, badge_key)
  values (new.user_id, 'meydan_okuyucu')
  on conflict do nothing;
  return new;
end $$;
revoke all on function public.award_challenge_badge() from public;

drop trigger if exists challenge_entries_badge_trg on public.challenge_entries;
create trigger challenge_entries_badge_trg
  after insert on public.challenge_entries
  for each row execute function public.award_challenge_badge();

notify pgrst, 'reload schema';
