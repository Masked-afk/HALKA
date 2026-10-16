-- Kritik eşleşmesi: "eleştiri istiyorum" diyen eserler gönüllü eleştirmenlere
-- rastgele atanır; eleştirmen okuyup yorumlayınca görevi tamamlar.
-- 202610170020_challenges.sql sonrasında çalıştırılır.

create table if not exists public.critique_matches (
  id uuid primary key default gen_random_uuid(),
  post_id uuid not null references public.posts(id) on delete cascade,
  critic_id uuid not null references auth.users(id) on delete cascade,
  done_at timestamptz,
  created_at timestamptz not null default now(),
  unique (post_id, critic_id)
);
create index if not exists critique_matches_critic_idx on public.critique_matches (critic_id, created_at desc);
create index if not exists critique_matches_post_idx on public.critique_matches (post_id) where done_at is null;

alter table public.critique_matches enable row level security;
grant select, insert, update on public.critique_matches to authenticated;

drop policy if exists critique_matches_select on public.critique_matches;
create policy critique_matches_select on public.critique_matches
  for select to authenticated
  using (critic_id = auth.uid() or exists (select 1 from public.posts p where p.id = post_id and p.author_id = auth.uid()));

-- Eşleşme: girişli, eser eleştiri istiyor, kendi eseri değil
drop policy if exists critique_matches_insert on public.critique_matches;
create policy critique_matches_insert on public.critique_matches
  for insert to authenticated with check (
    critic_id = auth.uid()
    and exists (
      select 1 from public.posts p
      where p.id = post_id and p.critique_wanted = true and p.author_id <> auth.uid()
    )
  );

-- Yalnızca eleştirmen kendi eşleşmesini tamamlar
drop policy if exists critique_matches_update on public.critique_matches;
create policy critique_matches_update on public.critique_matches
  for update to authenticated using (critic_id = auth.uid()) with check (critic_id = auth.uid());

notify pgrst, 'reload schema';
