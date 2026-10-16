-- Roportaj kosesi: topluluk adminleri uyelerle roportaj yayinlar.
-- Herkes okur (topluluk vitrini), sadece admin/kurucu yazar.

create table if not exists public.community_interviews (
  id uuid primary key default gen_random_uuid(),
  community_id uuid not null references public.communities(id) on delete cascade,
  interviewer_id uuid not null references auth.users(id) on delete cascade,
  guest_id uuid not null references auth.users(id) on delete cascade,
  title text not null check (length(btrim(title)) between 1 and 160),
  body text not null check (length(btrim(body)) between 1 and 20000),
  pinned boolean not null default false,
  created_at timestamptz not null default now()
);
create index if not exists community_interviews_idx on public.community_interviews (community_id, pinned desc, created_at desc);

alter table public.community_interviews enable row level security;

drop policy if exists community_interviews_select on public.community_interviews;
create policy community_interviews_select on public.community_interviews
  for select using (true);

drop policy if exists community_interviews_insert on public.community_interviews;
create policy community_interviews_insert on public.community_interviews
  for insert to authenticated with check (
    interviewer_id = auth.uid() and (
      exists (select 1 from public.communities c where c.id = community_id and c.created_by = auth.uid())
      or exists (select 1 from public.community_members cm where cm.community_id = community_id and cm.user_id = auth.uid() and cm.role = 'admin')
    )
  );

drop policy if exists community_interviews_update on public.community_interviews;
create policy community_interviews_update on public.community_interviews
  for update to authenticated using (
    exists (select 1 from public.communities c where c.id = community_id and c.created_by = auth.uid())
    or exists (select 1 from public.community_members cm where cm.community_id = community_id and cm.user_id = auth.uid() and cm.role = 'admin')
  );

drop policy if exists community_interviews_delete on public.community_interviews;
create policy community_interviews_delete on public.community_interviews
  for delete to authenticated using (
    exists (select 1 from public.communities c where c.id = community_id and c.created_by = auth.uid())
    or exists (select 1 from public.community_members cm where cm.community_id = community_id and cm.user_id = auth.uid() and cm.role = 'admin')
  );
