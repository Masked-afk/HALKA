create table if not exists public.saved_posts (
  user_id uuid not null references auth.users(id) on delete cascade,
  post_id uuid not null references public.posts(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (user_id, post_id)
);

create index if not exists saved_posts_user_created_idx
  on public.saved_posts(user_id, created_at desc);

alter table public.saved_posts enable row level security;
revoke all on public.saved_posts from anon, authenticated;
grant select, insert, delete on public.saved_posts to authenticated;

drop policy if exists "Users can read own saved posts" on public.saved_posts;
create policy "Users can read own saved posts"
  on public.saved_posts for select to authenticated
  using (auth.uid() = user_id);

drop policy if exists "Users can save posts as themselves" on public.saved_posts;
create policy "Users can save posts as themselves"
  on public.saved_posts for insert to authenticated
  with check (auth.uid() = user_id);

drop policy if exists "Users can remove own saved posts" on public.saved_posts;
create policy "Users can remove own saved posts"
  on public.saved_posts for delete to authenticated
  using (auth.uid() = user_id);

drop policy if exists "Suspended accounts cannot use saved posts" on public.saved_posts;
create policy "Suspended accounts cannot use saved posts"
  on public.saved_posts as restrictive for all to authenticated
  using (public.current_user_can_use_app())
  with check (public.current_user_can_use_app());

notify pgrst, 'reload schema';
