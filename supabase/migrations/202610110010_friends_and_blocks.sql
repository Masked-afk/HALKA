create table if not exists public.friend_requests (
  id uuid primary key default gen_random_uuid(),
  sender_id uuid not null references auth.users(id) on delete cascade,
  receiver_id uuid not null references auth.users(id) on delete cascade,
  status text not null default 'pending' check (status in ('pending', 'accepted', 'rejected')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (sender_id, receiver_id)
);

create index if not exists friend_requests_receiver_status_idx
  on public.friend_requests(receiver_id, status);
create index if not exists friend_requests_sender_status_idx
  on public.friend_requests(sender_id, status);

alter table public.friend_requests enable row level security;
revoke all on public.friend_requests from anon, authenticated;
grant select, insert, update, delete on public.friend_requests to authenticated;

drop policy if exists "Users can see own friend requests" on public.friend_requests;
create policy "Users can see own friend requests"
  on public.friend_requests for select to authenticated
  using (auth.uid() = sender_id or auth.uid() = receiver_id);

drop policy if exists "Users can send friend requests" on public.friend_requests;
create policy "Users can send friend requests"
  on public.friend_requests for insert to authenticated
  with check (
    auth.uid() = sender_id
    and sender_id <> receiver_id
  );

drop policy if exists "Receivers can update friend requests" on public.friend_requests;
create policy "Receivers can update friend requests"
  on public.friend_requests for update to authenticated
  using (auth.uid() = receiver_id)
  with check (auth.uid() = receiver_id);

drop policy if exists "Users can delete own friend requests" on public.friend_requests;
create policy "Users can delete own friend requests"
  on public.friend_requests for delete to authenticated
  using (auth.uid() = sender_id or auth.uid() = receiver_id);

create table if not exists public.blocks (
  id uuid primary key default gen_random_uuid(),
  blocker_id uuid not null references auth.users(id) on delete cascade,
  blocked_id uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  unique (blocker_id, blocked_id)
);

create index if not exists blocks_blocker_idx on public.blocks(blocker_id);
create index if not exists blocks_blocked_idx on public.blocks(blocked_id);

alter table public.blocks enable row level security;
revoke all on public.blocks from anon, authenticated;
grant select, insert, delete on public.blocks to authenticated;

drop policy if exists "Users can see own blocks" on public.blocks;
create policy "Users can see own blocks"
  on public.blocks for select to authenticated
  using (auth.uid() = blocker_id or auth.uid() = blocked_id);

drop policy if exists "Users can block others" on public.blocks;
create policy "Users can block others"
  on public.blocks for insert to authenticated
  with check (auth.uid() = blocker_id and blocker_id <> blocked_id);

drop policy if exists "Blockers can unblock" on public.blocks;
create policy "Blockers can unblock"
  on public.blocks for delete to authenticated
  using (auth.uid() = blocker_id);

create or replace function public.are_friends(user_a uuid, user_b uuid)
returns boolean language sql stable security definer set search_path = ''
as $$
  select exists (
    select 1 from public.friend_requests fr
    where fr.status = 'accepted'
      and ((fr.sender_id = user_a and fr.receiver_id = user_b)
        or (fr.sender_id = user_b and fr.receiver_id = user_a))
  );
$$;
revoke all on function public.are_friends(uuid, uuid) from public;
grant execute on function public.are_friends(uuid, uuid) to authenticated;

create or replace function public.is_blocked(checker uuid, target uuid)
returns boolean language sql stable security definer set search_path = ''
as $$
  select exists (
    select 1 from public.blocks b
    where (b.blocker_id = checker and b.blocked_id = target)
       or (b.blocker_id = target and b.blocked_id = checker)
  );
$$;
revoke all on function public.is_blocked(uuid, uuid) from public;
grant execute on function public.is_blocked(uuid, uuid) to authenticated;

notify pgrst, 'reload schema';
